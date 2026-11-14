import base64
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
import attachments
import creation_store
import story_projects
import task_scheduler
import threading
import time
from unittest.mock import patch


class CreativeWorkflows(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.data = Path(self.folder.name)
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.execute(
            "CREATE TABLE messages(id INTEGER PRIMARY KEY,session_id TEXT,attachments TEXT)"
        )
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("CREATE TABLE sessions(id TEXT PRIMARY KEY)")
        self.db.executemany("INSERT INTO sessions VALUES(?)", [("a",), ("b",)])
        attachments.initialize(self.db)
        creation_store.initialize(self.db)
        story_projects.initialize(self.db)
        self.db.execute("CREATE TABLE evaluation_cases(id TEXT PRIMARY KEY,spec TEXT)")
        task_scheduler.initialize(self.db)

    def test_versions_restore_and_conflict(self):
        first = creation_store.create(
            self.db,
            self.data,
            {"session_id": "a", "name": "index.html", "content": "<h1>First</h1>"},
        )
        second = creation_store.update(
            self.db,
            self.data,
            first["id"],
            {"expected_head": first["version"], "content": "<h1>Second</h1>"},
        )
        with self.assertRaises(FileExistsError):
            creation_store.update(
                self.db,
                self.data,
                first["id"],
                {"expected_head": first["version"], "content": "stale"},
            )
        third = creation_store.update(
            self.db,
            self.data,
            first["id"],
            {"expected_head": second["version"], "restore_version": first["version"]},
        )
        item, version = creation_store.selected(self.db, self.data, first["id"])
        self.assertEqual(item["head"], third["version"])
        self.assertEqual(len(item["versions"]), 3)
        self.assertEqual(
            creation_store.text(self.data, version["attachment"]), "<h1>First</h1>"
        )
        with zipfile.ZipFile(
            io.BytesIO(creation_store.bundle(self.db, self.data, item["id"]))
        ) as archive:
            self.assertIn("index.html", archive.namelist())
        with self.assertRaises(ValueError):
            creation_store.create(
                self.db,
                self.data,
                {"session_id": "b", "attachment_id": version["attachment_id"]},
            )

    def test_preview_blocks_active_content(self):
        preview = creation_store.preview(
            '<script>alert(1)</script><iframe srcdoc="evil"></iframe><img src="https://example.com/a.png" onerror="evil()"><h1>safe</h1><base href="https://evil.test">',
            "index.html",
        )
        self.assertNotIn("<script", preview)
        self.assertNotIn("onerror", preview)
        self.assertNotIn("srcdoc", preview)
        self.assertNotIn("https://", preview)
        self.assertIn("script-src &#x27;none&#x27;", preview)

    def test_associated_css_and_image_are_scoped_and_bundled(self):
        image = attachments.upload(
            self.data,
            {
                "name": "art.png",
                "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN2kAAAAASUVORK5CYII=",
            },
        )
        css = attachments.upload(
            self.data,
            {
                "name": "theme.css",
                "data": base64.b64encode(
                    b"h1{color:red}body{background:url(art.png)}"
                ).decode(),
            },
        )
        for item in (image, css):
            self.db.execute(
                "INSERT INTO session_outputs(session_id,attachment_id) VALUES(?,?)",
                ("a", item["id"]),
            )
        creation = creation_store.create(
            self.db,
            self.data,
            {
                "session_id": "a",
                "name": "index.html",
                "content": '<link rel="stylesheet" href="theme.css"><h1>Title</h1><img src="art.png">',
            },
        )
        creation_store.update(
            self.db,
            self.data,
            creation["id"],
            {"expected_head": creation["version"], "assets": [image["id"], css["id"]]},
        )
        project, version = creation_store.selected(self.db, self.data, creation["id"])
        rendered = creation_store.document(self.db, self.data, project, version)
        self.assertIn("color:red", rendered)
        self.assertIn("data:image/png;base64,", rendered)
        with zipfile.ZipFile(
            io.BytesIO(creation_store.bundle(self.db, self.data, creation["id"]))
        ) as archive:
            self.assertEqual(
                set(archive.namelist()),
                {"index.html", "art.png", "theme.css", "astra-manifest.json"},
            )

    def test_story_revision_context_and_exports(self):
        project = story_projects.create(self.db, {"title": "Novel"})
        chapter = story_projects.save(
            self.db,
            project["id"],
            {
                "title": "Chapter one",
                "kind": "chapter",
                "content": "Hello <world> & reader",
            },
        )
        story_projects.save(
            self.db,
            project["id"],
            {
                "title": "Canon",
                "kind": "character",
                "state": "confirmed",
                "content": "Named Lin",
            },
        )
        story_projects.save(
            self.db,
            project["id"],
            {
                "title": "Guess",
                "kind": "note",
                "state": "assumption",
                "content": "Not confirmed",
            },
        )
        context = story_projects.context(self.db, project["id"])
        self.assertEqual(len(context["entries"]), 2)
        with self.assertRaises(FileExistsError):
            story_projects.save(
                self.db, project["id"], {**chapter, "expected_revision": 0}
            )
        saved = story_projects.save(
            self.db,
            project["id"],
            {**chapter, "expected_revision": 1, "content": "Revised"},
        )
        self.assertEqual(saved["revision"], 2)
        self.assertEqual(
            len(story_projects.history(self.db, project["id"], chapter["id"])), 2
        )
        for kind in ("docx", "epub"):
            raw, mime = story_projects.export(self.db, project["id"], kind)
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                for name in archive.namelist():
                    if name.endswith((".xml", ".rels", ".xhtml", ".opf")):
                        ET.fromstring(archive.read(name))
                if kind == "epub":
                    self.assertEqual(archive.namelist()[0], "mimetype")

    def schedule(self, **changes):
        self.db.execute("INSERT OR IGNORE INTO evaluation_cases VALUES('case','{}')")
        self.db.commit()
        job = task_scheduler.save(
            self.db,
            {
                "name": "Scheduled",
                "case_id": "case",
                "interval_seconds": 60,
                "enabled": True,
                "options": {"model": "test", "api_key": "never persist"},
                **changes,
            },
            1000,
        )
        self.db.commit()
        return job

    def test_schedule_claim_and_recovery(self):
        job = self.schedule()
        self.assertNotIn("api_key", job["options"])
        claim = task_scheduler.claim(self.db, 1060)
        self.db.commit()
        self.assertEqual(claim["id"], job["id"])
        self.assertIsNone(task_scheduler.claim(self.db, 1120))
        self.db.commit()
        task_scheduler.recover(self.db)
        self.db.commit()
        row = task_scheduler.listing(self.db)[0]
        self.assertFalse(row["enabled"])
        self.assertEqual(row["runs"][0]["status"], "needs_review")

    def test_schedule_missed_and_changed_definition(self):
        job = self.schedule()
        self.assertIsNone(task_scheduler.claim(self.db, 1300))
        self.db.commit()
        self.assertEqual(
            task_scheduler.listing(self.db)[0]["runs"][0]["status"], "skipped"
        )
        self.db.execute("UPDATE evaluation_cases SET spec='changed'")
        self.db.commit()
        self.assertIsNone(task_scheduler.claim(self.db, 1400))
        self.db.commit()
        self.assertFalse(task_scheduler.listing(self.db)[0]["enabled"])

    def test_run_once_catchup_and_daily_boundary(self):
        job = self.schedule(missed="run_once")
        self.assertEqual(task_scheduler.claim(self.db, 10000)["id"], job["id"])
        self.db.commit()
        self.assertGreater(task_scheduler.listing(self.db)[0]["next_due"], 10000)
        self.assertGreater(task_scheduler.next_daily(1800000000, "09:00"), 1800000000)


class ScheduledIntegration(unittest.TestCase):
    def test_scheduled_task_uses_durable_chat_and_live_policy(self):
        import backend
        import runtime_engine
        import security_core
        import task_evaluations

        with tempfile.TemporaryDirectory() as folder, patch.object(
            backend, "DATA", Path(folder)
        ):
            backend.initialize()
            security_core.write_config(
                Path(folder) / "settings.json",
                {
                    **backend.DEFAULTS,
                    "base_url": "https://fixture.invalid/v1",
                    "model": "test",
                },
            )
            runtime_engine.save_settings(Path(folder), {"access_policy": "ask"})
            with backend.database() as db:
                case = task_evaluations.save(
                    db,
                    Path(folder),
                    {
                        "name": "Fixture",
                        "prompt": "Reply fixture",
                        "category": "story",
                        "expected_files": [],
                        "expected_outputs": [],
                        "require_checks": False,
                        "manual_review": True,
                    },
                )
                job = task_scheduler.save(
                    db,
                    {
                        "name": "Scheduled fixture",
                        "case_id": case["id"],
                        "interval_seconds": 60,
                        "enabled": True,
                        "options": {"allow_tools": False},
                    },
                    1000,
                )
            scheduler = task_scheduler.Scheduler(
                backend.database, backend.dispatch_schedule
            )
            with patch.object(backend, "completion", return_value="Scheduled result"):
                scheduler.tick(1060)
                for _ in range(100):
                    with backend.database() as db:
                        run = task_scheduler.listing(db)[0]["runs"][0]
                        request = db.execute(
                            "SELECT * FROM stream_requests WHERE id=?",
                            (run["request_id"],),
                        ).fetchone()
                    if (
                        request
                        and request["status"] != "running"
                        and run["session_id"] not in backend.BUSY
                    ):
                        break
                    time.sleep(0.05)
                self.assertIsNotNone(request)
                self.assertNotEqual(request["status"], "running")
                scheduler.tick(1065)
            with backend.database() as db:
                self.assertEqual(
                    db.execute(
                        "SELECT content FROM messages WHERE session_id=? AND role='assistant'",
                        (run["session_id"],),
                    ).fetchone()[0],
                    "Scheduled result",
                )
                self.assertIsNotNone(
                    db.execute(
                        "SELECT 1 FROM executions WHERE request_id=?",
                        (run["request_id"],),
                    ).fetchone()
                )
            runtime_engine.save_settings(Path(folder), {"access_policy": "deny"})
            scheduler.tick(1120)
            with backend.database() as db:
                result = task_scheduler.listing(db)[0]
                self.assertFalse(result["enabled"])
                self.assertEqual(result["runs"][0]["status"], "needs_review")


if __name__ == "__main__":
    unittest.main()
