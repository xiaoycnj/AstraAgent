"""Offline reference matching. Metadata discovery never changes transport identity."""

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


def lookup(config, model_id):
    """Prefer a known provider, otherwise require unambiguous exact reference IDs."""
    selected = vendor(config)
    providers = catalog()["providers"]
    matches = []
    for provider in providers:
        if selected and provider["id"] != selected:
            continue
        for model in provider["models"]:
            if model["id"] == model_id:
                matches.append(
                    {
                        "provider": provider["id"],
                        "provider_name": provider["name"],
                        "model": model,
                    }
                )
    if not matches:
        return {"id": model_id, "status": "unknown", "matches": []}
    keys = (
        "kind",
        "context_window",
        "max_output",
        "input_price",
        "output_price",
        "cached_input_price",
        "currency",
        "multimodal",
        "tool_calling",
        "reasoning",
        "reasoning_levels",
        "tier",
        "enabled",
    )
    signatures = {
        json.dumps({key: row["model"].get(key) for key in keys}, sort_keys=True)
        for row in matches
    }
    if len(signatures) > 1:
        return {"id": model_id, "status": "ambiguous", "matches": matches}
    return {
        "id": model_id,
        "status": "matched",
        "model": matches[0]["model"],
        "matches": matches,
    }
