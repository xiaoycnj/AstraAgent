"""Claude Messages bridge with bounded streaming and lossless in-turn tool blocks."""

import copy
import json
from contextlib import ExitStack
from urllib.request import Request, HTTPRedirectHandler
import security_net
import task_control


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def payload_for(config, payload):
    systems = []
    messages = []
    for message in payload["messages"]:
        role = message["role"]
        if role in ("system", "developer"):
            systems.append({"type": "text", "text": str(message.get("content", ""))})
            continue
        if role == "tool":
            content = [
                {
                    "type": "tool_result",
                    "tool_use_id": message["tool_call_id"],
                    "content": str(message.get("content", "")),
                }
            ]
            role = "user"
        elif message.get("_anthropic_content"):
            content = copy.deepcopy(message["_anthropic_content"])
        else:
            value = message.get("content")
            content = []
            if isinstance(value, str) and value:
                content.append({"type": "text", "text": value})
            elif isinstance(value, list):
                for part in value:
                    if part.get("type") == "text":
                        content.append({"type": "text", "text": part["text"]})
                    elif part.get("type") == "image_url":
                        url = part["image_url"]["url"]
                        if url.startswith("data:"):
                            header, data = url.split(",", 1)
                            content.append(
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": header[5:].split(";")[0],
                                        "data": data,
                                    },
                                }
                            )
                        else:
                            raise ValueError("Claude 图片请上传为本地附件")
            for call in message.get("tool_calls", []):
                content.append(
                    {
                        "type": "tool_use",
                        "id": call["id"],
                        "name": call["function"]["name"],
                        "input": json.loads(call["function"]["arguments"]),
                    }
                )
        if not content:
            continue
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"].extend(content)
        else:
            messages.append({"role": role, "content": content})
    result = {
        "model": payload["model"],
        "messages": messages,
        "max_tokens": config.get("max_output_tokens", 16384),
        "stream": bool(payload.get("stream")),
    }
    if systems:
        result["system"] = systems
    if payload.get("tools"):
        result["tools"] = [
            {
                "name": tool["function"]["name"],
                "description": tool["function"].get("description", ""),
                "input_schema": tool["function"]["parameters"],
            }
            for tool in payload["tools"]
        ]
    effort = config.get("reasoning", "default")
    model = payload["model"].lower().replace(".", "-")
    adaptive_required = any(
        part in model
        for part in (
            "opus-4-7",
            "opus-4-8",
            "opus-5",
            "sonnet-5",
            "haiku-5",
            "mythos",
            "fable",
        )
    )
    always_thinking = any(
        part in model for part in ("opus-5-5", "sonnet-5-5", "mythos", "fable")
    )
    if effort == "none" and always_thinking:
        effort = "low"
    adaptive = (
        config.get("thinking_mode") == "adaptive"
        or config.get("thinking_mode", "auto") == "auto"
        and any(
            part in model
            for part in (
                "4-6",
                "4.6",
                "4-7",
                "4.7",
                "4-8",
                "4.8",
                "-5",
                "mythos",
                "fable",
            )
        )
    )
    adaptive = adaptive or adaptive_required
    if effort == "none":
        result["thinking"] = {"type": "disabled"}
    elif effort != "default":
        if adaptive:
            result["thinking"] = {"type": "adaptive"}
            mapped = {"minimal": "low", "xhigh": "high"}.get(effort, effort)
            if effort == "xhigh" and any(
                part in model
                for part in ("4-7", "4.7", "4-8", "4.8", "-5", "mythos", "fable")
            ):
                mapped = "xhigh"
            result["output_config"] = {"effort": mapped}
        else:
            budget = (
                config.get("thinking_budget", 4096)
                if config.get("thinking_mode") == "budget"
                else {
                    "minimal": 1024,
                    "low": 2048,
                    "medium": 4096,
                    "high": 8192,
                    "xhigh": 12288,
                    "max": 16384,
                }.get(effort, 4096)
            )
            result["thinking"] = {
                "type": "enabled",
                "budget_tokens": min(budget, result["max_tokens"] - 1),
            }
    cache = config.get("cache_mode", "auto")
    if cache != "off":
        marker = {"type": "ephemeral"}
        if cache == "1h":
            marker["ttl"] = "1h"
        if messages:
            result["cache_control"] = copy.deepcopy(marker)
        if systems:
            systems[-1]["cache_control"] = marker
        elif result.get("tools"):
            result["tools"][-1]["cache_control"] = marker
    return result


def normalized(content, usage):
    message = {
        "role": "assistant",
        "content": "".join(
            block.get("text", "") for block in content if block["type"] == "text"
        ),
        "_anthropic_content": content,
    }
    calls = [
        {
            "id": block["id"],
            "type": "function",
            "function": {
                "name": block["name"],
                "arguments": json.dumps(block["input"], ensure_ascii=False),
            },
        }
        for block in content
        if block["type"] == "tool_use"
    ]
    if calls:
        message["tool_calls"] = calls
    return {"choices": [{"message": message}], "usage": usage}


def call(config, endpoint, payload=None, emit=None):
    headers = {
        "x-api-key": config.get("api_key", ""),
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    body = (
        payload_for(config, {**payload, "stream": bool(emit)})
        if payload is not None
        else None
    )
    request = Request(
        config["base_url"]
        + ("/messages" if endpoint == "/chat/completions" else endpoint),
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode(),
        headers=headers,
    )
    task_control.check(config)
    with security_net.opener(
        NoRedirect(), allow_private=config.get("allow_private_network", False)
    ).open(request, timeout=config["timeout"]) as response, ExitStack() as resources:
        if config.get("_cancel_token"):
            resources.enter_context(
                config["_cancel_token"].resource(
                    lambda: task_control.close_response(response)
                )
            )
        if not emit:
            raw = response.read(8_000_001)
            if len(raw) > 8_000_000:
                raise ValueError("Claude 响应超过限制")
            result = json.loads(raw)
            return (
                normalized(result["content"], result.get("usage", {}))
                if endpoint == "/chat/completions"
                else result
            )
        blocks = {}
        usage = {}
        finished = False
        total = 0
        pending = []
        for raw in response:
            task_control.check(config)
            total += len(raw)
            if total > 8_000_000:
                raise ValueError("Claude 流超过限制")
            line = raw.decode("utf-8").rstrip("\r\n")
            if line.startswith("data:"):
                pending.append(line[5:].lstrip())
                continue
            if line or not pending:
                continue
            event = json.loads("\n".join(pending))
            pending = []
            kind = event["type"]
            if kind == "error":
                raise ValueError("Claude 流返回错误")
            if kind == "message_start":
                usage.update(event["message"].get("usage", {}))
            elif kind == "content_block_start":
                blocks[event["index"]] = copy.deepcopy(event["content_block"])
            elif kind == "content_block_delta":
                block = blocks[event["index"]]
                delta = event["delta"]
                dtype = delta["type"]
                if dtype == "text_delta":
                    block["text"] = block.get("text", "") + delta["text"]
                    emit({"type": "delta", "text": delta["text"]})
                elif dtype == "input_json_delta":
                    block["_json"] = block.get("_json", "") + delta["partial_json"]
                elif dtype == "thinking_delta":
                    block["thinking"] = block.get("thinking", "") + delta["thinking"]
                elif dtype == "signature_delta":
                    block["signature"] = block.get("signature", "") + delta["signature"]
            elif kind == "message_delta":
                usage.update(event.get("usage", {}))
            elif kind == "message_stop":
                finished = True
        if not finished:
            raise ValueError("Claude 流中断，未收到完成事件")
        content = []
        for index in sorted(blocks):
            block = blocks[index]
            if "_json" in block:
                block["input"] = json.loads(block.pop("_json"))
            content.append(block)
        config["_reported_usage"] = usage
        return normalized(content, usage)
