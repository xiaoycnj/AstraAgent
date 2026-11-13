"""Build an attributed offline catalog from a downloaded models.dev snapshot."""

import argparse
import hashlib
import json
from pathlib import Path
from datetime import date

ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = (
    "openai",
    "anthropic",
    "deepseek",
    "zhipuai",
    "alibaba",
    "alibaba-cn",
    "moonshotai",
    "moonshotai-cn",
    "minimax",
    "minimax-cn",
    "xiaomi",
    "google",
    "longcat",
    "stepfun",
    "volcengine",
)
DEFAULT_API = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "google": "https://generativelanguage.googleapis.com/v1beta/openai",
}


def build(source, output):
    raw = source.read_bytes()
    data = json.loads(raw)
    providers = []
    for key in PROVIDERS:
        provider = data.get(key)
        if not provider:
            raise ValueError("Missing provider " + key)
        models = []
        for mid, model in provider.get("models", {}).items():
            modalities = model.get("modalities", {})
            incoming = modalities.get("input", [])
            outgoing = modalities.get("output", [])
            kind = (
                "image"
                if "image" in outgoing
                else (
                    "video"
                    if "video" in outgoing
                    else (
                        "chat"
                        if "text" in incoming
                        and "text" in outgoing
                        and model.get("type")
                        not in ("embedding", "transcription", "speech")
                        else "other"
                    )
                )
            )
            name = model.get("name", mid)
            lower = mid.lower()
            tier = "advanced"
            if any(
                word in lower
                for word in ("mini", "lite", "flash", "haiku", "hydrogen", "luna")
            ):
                tier = "standard"
            elif any(
                word in lower
                for word in (
                    "astra",
                    "opus",
                    "fable",
                    "mythos",
                    "pro",
                    "max",
                    "glm-5",
                    "qwen3-max",
                )
            ):
                tier = "flagship"
            options = model.get("reasoning_options", [])
            levels = next(
                (
                    item.get("values", [])
                    for item in options
                    if item.get("type") == "effort"
                ),
                [],
            )
            row = {
                "id": mid,
                "name": name,
                "kind": kind,
                "multimodal": "image" in incoming,
                "tool_calling": model.get("tool_call", False),
                "reasoning": model.get("reasoning", False),
                "reasoning_levels": levels,
                "tier": tier,
                "modalities": modalities,
                "enabled": model.get("status") not in ("deprecated", "retired"),
                "status": model.get("status", "active"),
                "currency": "USD",
                "source": "https://models.dev",
                "source_updated": model.get("last_updated"),
                "pricing_tiers": model.get("cost", {}).get("tiers", []),
            }
            for field, value in [
                ("context_window", model.get("limit", {}).get("context")),
                ("max_output", model.get("limit", {}).get("output")),
                ("input_price", model.get("cost", {}).get("input")),
                ("output_price", model.get("cost", {}).get("output")),
                ("cached_input_price", model.get("cost", {}).get("cache_read")),
            ]:
                if value is not None and (
                    field not in ("context_window", "max_output") or value > 0
                ):
                    row[field] = value
            models.append(row)
        providers.append(
            {
                "id": key,
                "name": provider.get("name", key),
                "api": provider.get("api") or DEFAULT_API.get(key, ""),
                "protocols": (
                    ["messages"]
                    if key == "anthropic"
                    else ["chat", "responses"] if key == "openai" else ["chat"]
                ),
                "models": models,
            }
        )
    document = {
        "schema_version": 1,
        "retrieved_at": date.today().isoformat(),
        "source": "https://models.dev/api.json",
        "source_sha256": hashlib.sha256(raw).hexdigest(),
        "license": "MIT",
        "tier_note": "Local routing presets, not benchmark rankings. User overrides take precedence.",
        "providers": providers,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        len(providers), "providers", sum(len(p["models"]) for p in providers), "models"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    build(args.source, ROOT / "web/assets/models/registry.json")
