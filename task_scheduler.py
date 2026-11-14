"""Persistent single-dispatch scheduler. Interrupted dispatches require explicit review."""

import hashlib
import json
import math
import threading
import time
import uuid
from datetime import datetime, timedelta
import execution_state


def initialize(db):
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY,name TEXT NOT NULL,case_id TEXT NOT NULL,fingerprint TEXT NOT NULL,kind TEXT NOT NULL,interval_seconds INTEGER NOT NULL,daily_time TEXT NOT NULL,next_due REAL NOT NULL,missed TEXT NOT NULL,enabled INTEGER NOT NULL,options TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS schedule_runs(id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,scheduled_for REAL NOT NULL,status TEXT NOT NULL,session_id TEXT NOT NULL DEFAULT '',request_id TEXT NOT NULL DEFAULT '',detail TEXT NOT NULL DEFAULT '',UNIQUE(schedule_id,scheduled_for));
    """
    )


def fingerprint(spec):
    return hashlib.sha256(spec.encode("utf-8")).hexdigest()


def listing(db):
    result = []
    for row in db.execute("SELECT * FROM schedules ORDER BY rowid DESC LIMIT 100"):
        item = dict(row)
        item["enabled"] = bool(item["enabled"])
        item["options"] = json.loads(item["options"])
        item["runs"] = [
            dict(run)
            for run in db.execute(
                "SELECT * FROM schedule_runs WHERE schedule_id=? ORDER BY scheduled_for DESC LIMIT 20",
                (item["id"],),
            )
        ]
        result.append(item)
    return result


def next_daily(now, clock):
    hour, minute = map(int, clock.split(":"))
    local = datetime.fromtimestamp(now)
    due = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if due.timestamp() <= now:
        due += timedelta(days=1)
    return due.timestamp()


def save(db, body, now=None):
    now = time.time() if now is None else now
    key = body.get("id") or uuid.uuid4().hex
    if (
        body.get("id")
        and not db.execute("SELECT 1 FROM schedules WHERE id=?", (key,)).fetchone()
    ):
        raise ValueError("定时任务不存在")
    if db.execute(
        "SELECT 1 FROM schedule_runs WHERE schedule_id=? AND status IN ('dispatching','running')",
        (key,),
    ).fetchone():
        raise ValueError("请先停止正在执行的任务")
    name = body.get("name")
    kind = body.get("kind", "interval")
    missed = body.get("missed", "skip")
    enabled = body.get("enabled", False)
    if (
        not isinstance(name, str)
        or not 1 <= len(name.strip()) <= 100
        or kind not in ("interval", "daily", "once")
        or missed not in ("skip", "run_once")
        or type(enabled) is not bool
    ):
        raise ValueError("定时任务参数无效")
    row = db.execute(
        "SELECT spec FROM evaluation_cases WHERE id=?", (body.get("case_id"),)
    ).fetchone()
    if not row:
        raise ValueError("请先在任务验收中保存一个任务")
    interval = body.get("interval_seconds", 3600)
    clock = body.get("daily_time", "09:00")
    if type(interval) is not int or not 60 <= interval <= 31_536_000:
        raise ValueError("间隔需在 60 秒到一年之间")
    if (
        not isinstance(clock, str)
        or len(clock) != 5
        or clock[2] != ":"
        or not clock.replace(":", "").isascii()
        or not clock.replace(":", "").isdigit()
        or int(clock[:2]) > 23
        or int(clock[3:]) > 59
    ):
        raise ValueError("每日时间需为 HH:MM")
    due = now + interval if kind == "interval" else next_daily(now, clock)
    if kind == "once":
        due = body.get("next_due")
        if type(due) not in (int, float) or not math.isfinite(due) or due <= now:
            raise ValueError("单次执行时间需晚于当前时间")
    options = body.get("options", {})
    if not isinstance(options, dict) or len(json.dumps(options)) > 20000:
        raise ValueError("执行配置无效")
    options = {
        key: options[key] for key in execution_state.REQUEST_FIELDS if key in options
    }
    # The case owns its project binding. Credentials are always resolved at dispatch time.
    options.pop("project_id", None)
    db.execute(
        "INSERT INTO schedules VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,case_id=excluded.case_id,fingerprint=excluded.fingerprint,kind=excluded.kind,interval_seconds=excluded.interval_seconds,daily_time=excluded.daily_time,next_due=excluded.next_due,missed=excluded.missed,enabled=excluded.enabled,options=excluded.options,error=excluded.error",
        (
            key,
            name.strip(),
            body["case_id"],
            fingerprint(row["spec"]),
            kind,
            interval,
            clock,
            due,
            missed,
            int(enabled),
            json.dumps(options, ensure_ascii=False),
            "",
        ),
    )
    return next(item for item in listing(db) if item["id"] == key)


def recover(db):
    db.execute(
        "UPDATE schedules SET enabled=0,error='上次执行结果需核对，请打开会话后重新启用' WHERE id IN (SELECT schedule_id FROM schedule_runs WHERE status IN ('dispatching','running'))"
    )
    db.execute(
        "UPDATE schedule_runs SET status='needs_review',detail='应用重启，自动重试已暂停' WHERE status IN ('dispatching','running')"
    )


def claim(db, now):
    db.execute("BEGIN IMMEDIATE")
    if db.execute(
        "SELECT 1 FROM schedule_runs WHERE status IN ('dispatching','running')"
    ).fetchone():
        return None
    row = db.execute(
        "SELECT * FROM schedules WHERE enabled=1 AND next_due<=? ORDER BY next_due LIMIT 1",
        (now,),
    ).fetchone()
    if not row:
        return None
    item = dict(row)
    spec = db.execute(
        "SELECT spec FROM evaluation_cases WHERE id=?", (item["case_id"],)
    ).fetchone()
    if not spec or fingerprint(spec["spec"]) != item["fingerprint"]:
        db.execute(
            "UPDATE schedules SET enabled=0,error='任务定义已变化，请重新保存定时配置' WHERE id=?",
            (item["id"],),
        )
        return None
    due = item["next_due"]
    following = (
        next_daily(now, item["daily_time"])
        if item["kind"] == "daily"
        else due
        + (int((now - due) // item["interval_seconds"]) + 1) * item["interval_seconds"]
    )
    db.execute(
        "UPDATE schedules SET next_due=?,enabled=? WHERE id=?",
        (following, int(item["kind"] != "once"), item["id"]),
    )
    late = now - due > 60
    key = uuid.uuid4().hex
    status = "skipped" if late and item["missed"] == "skip" else "dispatching"
    db.execute(
        "INSERT INTO schedule_runs(id,schedule_id,scheduled_for,status,detail) VALUES(?,?,?,?,?)",
        (
            key,
            item["id"],
            due,
            status,
            "错过的触发已跳过" if status == "skipped" else "",
        ),
    )
    return (
        {**item, "run_id": key, "options": json.loads(item["options"])}
        if status == "dispatching"
        else None
    )


class Scheduler:
    def __init__(self, database, dispatch):
        self.database = database
        self.dispatch = dispatch
        self.stop = threading.Event()

    def tick(self, now=None):
        with self.database() as db:
            for run in db.execute(
                "SELECT id,request_id FROM schedule_runs WHERE status='running'"
            ).fetchall():
                request = db.execute(
                    "SELECT status FROM stream_requests WHERE id=?",
                    (run["request_id"],),
                ).fetchone()
                if request and request["status"] != "running":
                    db.execute(
                        "UPDATE schedule_runs SET status=? WHERE id=?",
                        (request["status"], run["id"]),
                    )
                if not request:
                    db.execute(
                        "UPDATE schedule_runs SET status='needs_review',detail='执行记录已移除' WHERE id=?",
                        (run["id"],),
                    )
        with self.database() as db:
            job = claim(db, time.time() if now is None else now)
        if not job:
            return
        try:
            self.dispatch(job)
        except Exception:
            with self.database() as db:
                db.execute(
                    "UPDATE schedule_runs SET status='needs_review',detail='派发失败，请检查模型配置、权限与关联会话' WHERE id=?",
                    (job["run_id"],),
                )
                db.execute(
                    "UPDATE schedules SET enabled=0,error='派发失败，已暂停自动执行' WHERE id=?",
                    (job["id"],),
                )

    def start(self):
        with self.database() as db:
            recover(db)

        def work():
            while not self.stop.wait(5):
                try:
                    self.tick()
                except Exception:
                    pass  # The next transaction retries polling, never a claimed dispatch.

        threading.Thread(target=work, daemon=True, name="astra-scheduler").start()
