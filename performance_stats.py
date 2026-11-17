"""Read-only performance aggregates over the lifetime usage ledger.

Historical usage rows remain valid without timing or response identity. Rates use
only completed, provider-counted output with a measured positive time window.
"""

from datetime import date, datetime, timedelta, timezone
import math
import time
from usage_meter import database

RATE = "status='completed' AND output>0 AND duration_ms>0"
GENERATION = "status='completed' AND output>0 AND generation_ms>0"
AGGREGATE = f"""
COUNT(*) calls,
SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) completed,
SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) failed,
SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) cancelled,
COUNT(duration_ms) timed,COUNT(output) output_reported,
COALESCE(SUM(output),0) output_tokens,
SUM(CASE WHEN {RATE} THEN 1 ELSE 0 END) speed_samples,
SUM(CASE WHEN {GENERATION} THEN 1 ELSE 0 END) generation_samples,
1000.0*SUM(CASE WHEN {RATE} THEN output END)/SUM(CASE WHEN {RATE} THEN duration_ms END) tokens_per_second,
1000.0*SUM(CASE WHEN {GENERATION} THEN output END)/SUM(CASE WHEN {GENERATION} THEN generation_ms END) generation_tokens_per_second,
AVG(CASE WHEN status='completed' THEN duration_ms END) avg_duration_ms,
AVG(CASE WHEN status='completed' THEN ttft_ms END) avg_ttft_ms,
SUM(CASE WHEN identity='same' THEN 1 ELSE 0 END) same,
SUM(CASE WHEN identity='different' THEN 1 ELSE 0 END) different,
SUM(CASE WHEN identity='unknown' THEN 1 ELSE 0 END) unknown
"""


def dashboard(data, query=None):
    query = query or {}

    def single(key, default=""):
        values = query.get(key, [default])
        if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str):
            raise ValueError("Invalid filter")
        return values[0]

    offset = int(single("offset", "0"))
    page = int(single("page", "0"))
    if not -840 <= offset <= 840 or not 0 <= page <= 1_000_000:
        raise ValueError("Invalid paging or timezone")
    model = single("model")
    provider = single("provider")
    identity = single("identity")
    status = single("status")
    if (
        len(model) > 200
        or len(provider) > 200
        or identity not in ("", "same", "different", "unknown")
        or status not in ("", "completed", "failed", "cancelled")
    ):
        raise ValueError("Invalid filter")
    start = single("start")
    end = single("end")

    def midnight(value):
        return datetime.combine(
            date.fromisoformat(value), datetime.min.time(), timezone.utc
        ) - timedelta(minutes=offset)

    if start and end and date.fromisoformat(start) > date.fromisoformat(end):
        raise ValueError("Invalid range")
    clauses = []
    params = []
    for field, value in [
        ("model", model),
        ("provider_id", provider),
        ("identity", identity),
        ("status", status),
    ]:
        if value:
            clauses.append(field + "=?")
            params.append(value)
    if start:
        clauses.append("stamp>=?")
        params.append(midnight(start).timestamp())
    if end:
        clauses.append("stamp<?")
        params.append((midnight(end) + timedelta(days=1)).timestamp())
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    cte = """WITH measured AS (SELECT *,CASE
        WHEN response_model IS NULL OR response_model='' THEN 'unknown'
        WHEN COALESCE(model_changed,0)=1 OR response_model!=model THEN 'different'
        ELSE 'same' END identity FROM usage_events) """
    with database(data) as db:
        # All reads in a response share a snapshot while generation may continue.
        if not db.in_transaction:
            db.execute("BEGIN")
        summary = dict(
            db.execute(cte + "SELECT " + AGGREGATE + " FROM measured" + where, params).fetchone()
        )
        for key in (
            "completed",
            "failed",
            "cancelled",
            "speed_samples",
            "generation_samples",
            "same",
            "different",
            "unknown",
        ):
            summary[key] = summary[key] or 0

        def percentile(field, p):
            condition = (
                (where + " AND " if where else " WHERE ")
                + "status='completed' AND "
                + field
                + " IS NOT NULL"
            )
            count = db.execute(
                cte + "SELECT COUNT(*) FROM measured" + condition, params
            ).fetchone()[0]
            if not count:
                return None
            return db.execute(
                cte
                + "SELECT "
                + field
                + " FROM measured"
                + condition
                + " ORDER BY "
                + field
                + " LIMIT 1 OFFSET ?",
                params + [max(0, math.ceil(count * p) - 1)],
            ).fetchone()[0]

        summary["p50_ttft_ms"] = percentile("ttft_ms", 0.5)
        summary["p95_ttft_ms"] = percentile("ttft_ms", 0.95)
        summary["p95_duration_ms"] = percentile("duration_ms", 0.95)
        summary["ttft_samples"] = db.execute(
            cte
            + "SELECT COUNT(*) FROM measured"
            + (where + " AND " if where else " WHERE ")
            + "status='completed' AND ttft_ms IS NOT NULL",
            params,
        ).fetchone()[0]
        known = summary["same"] + summary["different"]
        summary["identity_rate"] = summary["same"] / known if known else None
        models = [
            dict(row)
            for row in db.execute(
                cte
                + "SELECT provider_id,MAX(provider_name) provider_name,model,"
                + AGGREGATE
                + " FROM measured"
                + where
                + " GROUP BY provider_id,model ORDER BY tokens_per_second DESC,model,provider_id",
                params,
            )
        ]
        bounds = db.execute(
            cte + "SELECT MIN(stamp),MAX(stamp) FROM measured" + where, params
        ).fetchone()
        monthly = bounds[0] is not None and bounds[1] - bounds[0] > 90 * 86400
        bucket = "%Y-%m" if monthly else "%Y-%m-%d"
        trend = [
            dict(row)
            for row in db.execute(
                cte
                + "SELECT strftime(?,stamp,'unixepoch',?) period,"
                + AGGREGATE
                + " FROM measured"
                + where
                + " GROUP BY period ORDER BY period",
                [bucket, str(offset) + " minutes", *params],
            )
        ]
        count = summary["calls"]
        pages = max(1, (count + 49) // 50)
        page = min(page, pages - 1)
        rows = [
            dict(row)
            for row in db.execute(
                cte
                + f"""SELECT id,stamp,model,provider_id,provider_name,status,input,output,total,requested_model,response_model,model_changed,identity,duration_ms,ttft_ms,generation_ms,
            CASE WHEN {RATE} THEN 1000.0*output/duration_ms END tokens_per_second,
            CASE WHEN {GENERATION} THEN 1000.0*output/generation_ms END generation_tokens_per_second
            FROM measured"""
                + where
                + " ORDER BY stamp DESC,id DESC LIMIT 50 OFFSET ?",
                params + [page * 50],
            )
        ]
        options = [
            dict(row)
            for row in db.execute(
                "SELECT COALESCE(provider_id,'') provider_id,MAX(provider_name) provider_name,model FROM usage_events GROUP BY provider_id,model ORDER BY model,provider_id"
            )
        ]
        since = db.execute("SELECT MIN(stamp) FROM usage_events").fetchone()[0]
    return {
        "summary": summary,
        "models": models,
        "trend": trend,
        "trend_unit": "month" if monthly else "day",
        "rows": rows,
        "page": page,
        "pages": pages,
        "page_size": 50,
        "options": options,
        "since": since,
        "generated_at": time.time(),
        "offset_minutes": offset,
    }
