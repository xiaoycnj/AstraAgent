"""Provider-scoped model specifications and explicitly estimated budgets."""

import json
import math
import model_registry

TYPES = {
    "chat_api": ("chat",),
    "image_api": ("image",),
    "video_api": ("video",),
    "multimodal_api": ("chat", "image", "video"),
}


def supports(provider, capability):
    return capability in provider.get(
        "capabilities", TYPES.get(provider.get("type", "chat_api"), ())
    )


def validate_model(model):
    result = {"id": model["id"], "name": model.get("name", model["id"])}
    for key in ("input_price", "output_price", "cached_input_price"):
        value = model.get(key)
        if key in model and value is None:
            result[key] = None
        if value is not None:
            if (
                type(value) not in (int, float)
                or not math.isfinite(value)
                or not 0 <= value <= 1_000_000
            ):
                raise ValueError("模型价格无效")
            result[key] = value
    context = model.get("context_window")
    if "context_window" in model and context is None:
        result["context_window"] = None
    if context is not None:
        if type(context) is not int or not 1024 <= context <= 10_000_000:
            raise ValueError("上下文窗口需为 1024 至 10000000 Token")
        result["context_window"] = context
    if model.get("multimodal") is not None:
        if type(model["multimodal"]) is not bool:
            raise ValueError("多模态能力格式无效")
        result["multimodal"] = model["multimodal"]
    elif "multimodal" in model:
        result["multimodal"] = None
    currency = model.get("currency", "USD")
    if currency not in ("USD", "CNY", "EUR", "JPY"):
        raise ValueError("价格币种无效")
    result["currency"] = currency
    kind = model.get("kind", "auto")
    if kind not in ("auto", "chat", "image", "video", "other"):
        raise ValueError("模型用途无效")
    result["kind"] = kind
    tier = model.get("tier", "advanced")
    if tier not in ("standard", "advanced", "flagship"):
        raise ValueError("模型等级无效")
    if "tier" in model:
        result["tier"] = tier
    for key in ("enabled", "tool_calling", "reasoning"):
        if key in model and model[key] is None:
            result[key] = None
        if key in model and model[key] is not None:
            if type(model[key]) is not bool:
                raise ValueError("模型能力开关无效")
            result[key] = model[key]
    if "reasoning_levels" in model:
        levels = model["reasoning_levels"]
        if (
            not isinstance(levels, list)
            or len(levels) > 8
            or any(
                value
                not in (
                    "none",
                    "minimal",
                    "low",
                    "medium",
                    "high",
                    "xhigh",
                    "max",
                    "ultra",
                )
                for value in levels
            )
        ):
            raise ValueError("推理档位列表无效")
        result["reasoning_levels"] = levels
    if model.get("max_output") is not None:
        limit = model["max_output"]
        if type(limit) is not int or not 1 <= limit <= 10_000_000:
            raise ValueError("模型输出上限无效")
        result["max_output"] = limit
    return result


def spec(config):
    stored = next(
        (row for row in config.get("models", []) if row["id"] == config.get("model")),
        {},
    )
    reference = model_registry.lookup(config, config.get("model", ""))
    inferred = dict(reference.get("model", {}))
    prices = ("input_price", "output_price", "cached_input_price")
    has_prices = any(stored.get(key) is not None for key in prices)
    explicit_currency = stored.get("currency") not in (None, "USD")
    if (
        (has_prices or explicit_currency)
        and stored.get("currency")
        and inferred.get("currency") != stored["currency"]
    ):
        for key in prices:
            inferred.pop(key, None)
    overrides = {
        key: value
        for key, value in stored.items()
        if value is not None
        and not (key == "kind" and value == "auto")
        and not (key == "reasoning_levels" and value == [])
    }
    if not has_prices and not explicit_currency and inferred.get("currency"):
        overrides.pop("currency", None)
    return {**inferred, **overrides}


def reasoning_effort(config, requested):
    model = spec(config)
    if model.get("reasoning") is False:
        return "none"
    order = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
    levels = [level for level in model.get("reasoning_levels", []) if level in order]
    if requested == "default" or not levels or requested in levels:
        return requested
    wanted = order.index(requested)
    return min(
        levels, key=lambda level: (abs(order.index(level) - wanted), order.index(level))
    )


def estimate_tokens(messages, tools=None):
    # A local budgeting estimate. Image payload bytes are never counted as text.
    size = 0
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, list):
            for part in content:
                size += (
                    3072
                    if part.get("type") == "image_url"
                    else len(str(part.get("text", "")).encode("utf-8"))
                )
        else:
            size += len(str(content or "").encode("utf-8"))
        size += (
            len(json.dumps(message.get("tool_calls", []), ensure_ascii=False).encode())
            + 24
        )
    size += len(json.dumps(tools or [], ensure_ascii=False).encode())
    return math.ceil(size / 3)


def needs_compaction(config, messages, tools=None):
    window = spec(config).get("context_window")
    if not window:
        return len(json.dumps(messages, ensure_ascii=False)) >= config.get(
            "context_chars", 60000
        )
    reserve = min(config.get("max_output_tokens", 16384), window // 4)
    return estimate_tokens(messages, tools) >= int(window * 0.8) - reserve


def cost(config, incoming, outgoing, cached=0):
    model = spec(config)
    if (
        incoming is None
        or outgoing is None
        or model.get("input_price") is None
        or model.get("output_price") is None
    ):
        return None
    cached = min(incoming, cached or 0)
    cached_price = model.get("cached_input_price")
    if cached_price is None:
        cached_price = model["input_price"]
    amount = (
        (incoming - cached) * model["input_price"]
        + cached * cached_price
        + outgoing * model["output_price"]
    ) / 1_000_000
    return {"currency": model.get("currency", "USD"), "amount": amount}
