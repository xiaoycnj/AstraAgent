"""Explicit provider contracts, isolated from the generic compatibility transport."""

import copy
import hashlib
import json
from urllib.parse import urlsplit

VENDORS = ("auto", "generic", "openai", "deepseek", "anthropic", "glm")
EFFORTS = ("default", "none", "minimal", "low", "medium", "high", "xhigh", "max")


def vendor(config):
    selected = config.get("vendor", "auto")
    if selected != "auto":
        return selected
    if config.get("auth_type") == "openai_oauth":
        return "openai"
    host = urlsplit(config.get("base_url", "")).hostname
    return {
        "api.openai.com": "openai",
        "api.deepseek.com": "deepseek",
        "api.anthropic.com": "anthropic",
        "open.bigmodel.cn": "glm",
        "api.z.ai": "glm",
    }.get(host, "generic")


def use_responses(config, payload=None):
    if (
        config.get("auth_type") == "openai_oauth"
        or config.get("api_protocol") == "responses"
    ):
        return True
    return (
        vendor(config) == "openai"
        and config.get("model", "").lower().startswith("gpt-6")
        and bool(
            payload
            and (
                payload.get("tools")
                or any(
                    message.get("_response_items") or message.get("role") == "tool"
                    for message in payload.get("messages", [])
                )
            )
        )
    )


def validate(body, result):
    for key, allowed, default in [
        ("vendor", VENDORS, "auto"),
        ("api_protocol", ("chat", "responses", "messages"), "chat"),
        ("cache_mode", ("auto", "off", "5m", "1h"), "auto"),
        ("thinking_mode", ("auto", "adaptive", "budget"), "auto"),
        ("verbosity", ("default", "low", "medium", "high"), "default"),
    ]:
        value = body.get(key, result.get(key, default))
        if value not in allowed:
            raise ValueError("模型适配选项无效：" + key)
        result[key] = value
    for key, default, low, high in [
        ("max_output_tokens", 16384, 1024, 131072),
        ("thinking_budget", 4096, 1024, 65536),
    ]:
        value = body.get(key, result.get(key, default))
        if type(value) is not int or not low <= value <= high:
            raise ValueError("模型预算无效：" + key)
        result[key] = value
    if (
        result["thinking_mode"] == "budget"
        and result["thinking_budget"] >= result["max_output_tokens"]
    ):
        raise ValueError("思考预算必须小于输出预算")
    kind = vendor(result)
    protocol = result["api_protocol"]
    if kind in ("deepseek", "glm") and protocol != "chat":
        raise ValueError("此厂商专项适配当前使用 Chat Completions 协议")
    if kind == "anthropic" and protocol == "responses":
        raise ValueError("Anthropic 专项适配请使用 Messages 协议")
    if kind == "openai" and protocol == "messages":
        raise ValueError("OpenAI 专项适配请使用 Chat 或 Responses 协议")
    return result


def prepare(config, payload):
    result = copy.deepcopy(payload)
    kind = vendor(config)
    effort = config.get("reasoning", result.get("reasoning_effort", "default"))
    if config.get("_model_reasoning") is False:
        effort = "default"
        result.pop("reasoning_effort", None)
    model = config.get("model", "").lower()
    for message in result.get("messages", []):
        if not use_responses(config, payload):
            message.pop("_anthropic_content", None)
            message.pop("_response_items", None)
        if kind == "generic" and not message.get("reasoning_content"):
            message.pop("reasoning_content", None)
    if kind == "generic":
        return result
    result.pop("reasoning_effort", None)
    if kind == "openai":
        supported = model.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4"))
        if effort != "default" and supported:
            mapped = effort
            if model.startswith(("o1", "o3", "o4")):
                mapped = {
                    "none": "low",
                    "minimal": "low",
                    "xhigh": "high",
                    "max": "high",
                }.get(effort, effort)
            if model.startswith("gpt-6"):
                mapped = {"none": "low", "minimal": "low"}.get(effort, effort)
                if model.startswith(("gpt-6-sol", "gpt-6-luna")) and effort == "none":
                    mapped = "none"
            if model.startswith("gpt-5.1"):
                mapped = {"minimal": "none", "xhigh": "high", "max": "high"}.get(
                    effort, effort
                )
            elif model.startswith("gpt-5."):
                mapped = {"minimal": "low", "max": "xhigh"}.get(effort, effort)
            elif model.startswith("gpt-5"):
                mapped = {"none": "minimal", "xhigh": "high", "max": "high"}.get(
                    effort, effort
                )
            result["reasoning_effort"] = mapped
        if config.get("cache_mode", "auto") != "off":
            prefix = [
                message
                for message in result.get("messages", [])
                if message.get("role") in ("system", "developer")
            ]
            identity = {
                "provider": config.get("id", config.get("base_url", "")),
                "model": model,
                "system": prefix,
            }
            result["prompt_cache_key"] = (
                "astra-"
                + hashlib.sha256(
                    json.dumps(identity, sort_keys=True, ensure_ascii=False).encode()
                ).hexdigest()[:48]
            )
        if supported:
            result["max_completion_tokens"] = config.get("max_output_tokens", 16384)
    elif kind in ("deepseek", "glm"):
        enabled = effort != "none"
        if kind == "glm" and model.startswith("glm-5.2") and effort == "minimal":
            enabled = False
        if kind == "glm" and model.startswith("glm-5.3"):
            enabled = True
            if effort == "none":
                effort = "low"
        if kind == "deepseek" or model.startswith(
            ("glm-4.5", "glm-4.6", "glm-4.7", "glm-5")
        ):
            result["thinking"] = {"type": "enabled" if enabled else "disabled"}
        modern_deepseek = model.startswith(("deepseek-flash", "deepseek-v4"))
        modern_glm = model.startswith(("glm-5.2", "glm-5.3"))
        if enabled and effort != "default" and (modern_deepseek or modern_glm):
            result["reasoning_effort"] = {
                "minimal": "low",
                "low": "low",
                "medium": "high",
                "high": "high",
                "xhigh": "high",
                "max": "max",
            }.get(effort, "high")
            if model.startswith("glm-5.2") and result["reasoning_effort"] == "low":
                result["reasoning_effort"] = "high"
            if modern_glm and effort in ("xhigh", "max"):
                result["reasoning_effort"] = "max"
        if enabled:
            for field in ("temperature", "presence_penalty", "frequency_penalty"):
                result.pop(field, None)
        result["max_tokens"] = config.get("max_output_tokens", 16384)
        if kind == "deepseek":
            for message in result.get("messages", []):
                if message.get("role") == "assistant":
                    message.setdefault("reasoning_content", "")
    if config.get("_model_reasoning") is False:
        result.pop("reasoning_effort", None)
        result.pop("thinking", None)
    return result


def assistant_message(message):
    result = {
        key: copy.deepcopy(message[key])
        for key in (
            "content",
            "tool_calls",
            "reasoning_content",
            "_anthropic_content",
            "_response_items",
        )
        if key in message
    }
    return {"role": "assistant", **result}


def initialize(db):
    db.execute(
        "CREATE TABLE IF NOT EXISTS provider_message_state(message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,identity TEXT NOT NULL,payload BLOB NOT NULL)"
    )


def identity(config):
    value = [
        vendor(config),
        config.get("api_protocol", "chat"),
        config.get("model"),
        config.get("base_url"),
        config.get("id", ""),
        config.get("_oauth_subject", ""),
        hashlib.sha256(config.get("api_key", "").encode()).hexdigest(),
    ]
    return hashlib.sha256(json.dumps(value).encode()).hexdigest()


def save_state(db, config, message_id):
    import security_core

    db.execute("DELETE FROM provider_message_state WHERE message_id=?", (message_id,))
    message = config.get("_last_provider_message", {})
    if message.get("tool_calls"):
        return
    extra = {
        key: message[key]
        for key in ("reasoning_content", "_anthropic_content", "_response_items")
        if message.get(key)
    }
    if not extra:
        return
    extra["_text_sha256"] = hashlib.sha256(
        str(message.get("content", "")).encode()
    ).hexdigest()
    raw = json.dumps(extra, ensure_ascii=False).encode()
    if len(raw) > 8_000_000:
        return
    db.execute(
        "INSERT OR REPLACE INTO provider_message_state VALUES(?,?,?)",
        (message_id, identity(config), security_core.protect(raw, True)),
    )


def hydrate(db, config, messages):
    import security_core

    history = config.get("_context_history", {})
    ids = history.get("ids", [])
    offset = len(messages) - len(ids) - 1
    if offset < 0 or [
        message.get("role") for message in messages[offset:-1]
    ] != history.get("roles"):
        return
    for index, key in enumerate(ids):
        message = messages[offset + index]
        if key is None or message.get("role") != "assistant":
            continue
        row = db.execute(
            "SELECT payload FROM provider_message_state WHERE message_id=? AND identity=?",
            (key, identity(config)),
        ).fetchone()
        if row is not None:
            try:
                extra = json.loads(security_core.protect(row["payload"], False))
                expected = extra.pop("_text_sha256", None)
                if (
                    expected
                    != hashlib.sha256(
                        str(message.get("content", "")).encode()
                    ).hexdigest()
                ):
                    continue
                message.update(extra)
            except (ValueError, OSError):
                continue
