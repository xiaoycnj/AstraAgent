"""Offline model identity matching. Never infer a vendor from a model's spelling."""

import json
import model_adapters
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit


@lru_cache(maxsize=1)
def catalog():
    return json.loads(
        (Path(__file__).resolve().parent / "web/assets/models/registry.json").read_text(
            encoding="utf-8"
        )
    )


def vendor(config):
    chosen = config.get("registry_vendor", "auto")
    if chosen != "auto":
        return chosen
    if config.get("auth_type") == "openai_oauth":
        return "openai"
    host = urlsplit(config.get("base_url", "")).hostname
    for provider in catalog()["providers"]:
        if host and urlsplit(provider["api"]).hostname == host:
            return provider["id"]
    return None


def match(config, model_id):
    selected = vendor(config)
    provider = next(
        (item for item in catalog()["providers"] if item["id"] == selected), None
    )
    protocol = (
        "messages"
        if model_adapters.vendor(config) == "anthropic"
        else config.get("api_protocol", "chat")
    )
    if not provider or protocol not in provider["protocols"]:
        return {}
    return next((model for model in provider["models"] if model["id"] == model_id), {})
