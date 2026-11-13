"""OpenAI-compatible image generation, using the existing bounded attachment store."""

import base64
import json
import re
import secrets
import model_catalog
import usage_meter
from urllib.parse import urlsplit
from urllib.request import Request, HTTPRedirectHandler
from urllib.error import HTTPError, URLError
import attachments
import security_net
import security_server
import task_control

IMAGE_PARAMETERS = {
    "type": "object",
    "properties": {
        "prompt": {"type": "string", "description": "根据用户需求润色后的完整提示词"},
        "provider": {
            "type": "string",
            "description": "图片服务商 ID，可通过 list_image_models 查看",
        },
        "model": {
            "type": "string",
            "description": "服务商已配置的模型 ID，例如 image2.5",
        },
        "size": {"type": "string", "description": "例如 1024x1024，也接受 1024*1024"},
        "file": {"type": "string", "description": "当前会话参考图片附件 ID"},
        "files": {"type": "array", "items": {"type": "string"}, "maxItems": 4},
        "quality": {
            "type": "string",
            "enum": ["auto", "low", "medium", "high", "standard", "hd"],
        },
        "background": {"type": "string", "enum": ["auto", "transparent", "opaque"]},
    },
    "required": ["prompt"],
    "additionalProperties": False,
}
DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": name,
            "description": "通过图片插件调用图片服务商。可先润色提示词，再传 model、size、file/files 参考图片。参考图仅使用当前会话附件 ID。调用可能产生费用。",
            "parameters": IMAGE_PARAMETERS,
        },
    }
    for name in ("generate_image", "image_gen")
]
DEFINITIONS.append(
    {
        "type": "function",
        "function": {
            "name": "list_image_models",
            "description": "查看已配置的图片服务商及模型，不发送网络请求。",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
        },
    }
)


def reference_images(args, config, context):
    ids = args.get("files", [])
    if not isinstance(ids, list):
        raise ValueError("参考图 files 必须是附件 ID 数组")
    ids = list(ids)
    if args.get("file"):
        ids.insert(0, args["file"])
    if len(ids) > 4 or any(not isinstance(key, str) for key in ids):
        raise ValueError("最多传入四张参考图片")
    ids = [re.sub(r"^/api/attachments/([^/]+)/content$", r"\1", key) for key in ids]
    allowed = set(config.get("_attachment_ids", []))
    if config.get("_session_id"):
        with context["database"]() as db:
            resources = attachments.resources(
                db, context["data"], config["_session_id"]
            )
        allowed.update(
            item["id"] for group in ("sources", "outputs") for item in resources[group]
        )
    images = []
    for key in dict.fromkeys(ids):
        if key not in allowed:
            raise ValueError("参考图必须来自当前会话")
        item = attachments.meta(context["data"], key)
        if item["kind"] != "image":
            raise ValueError("参考附件必须为图片")
        raw = (attachments.location(context["data"], key) / "content").read_bytes()
        images.append((item["mime"], raw))
    if sum(len(raw) for mime, raw in images) > 10 * 1024 * 1024:
        raise ValueError("参考图总计最多 10 MB")
    return images


def multipart(body, images):
    boundary = "astra-" + secrets.token_hex(24)
    chunks = []
    for key, value in body.items():
        chunks.append(
            (
                "--"
                + boundary
                + '\r\nContent-Disposition: form-data; name="'
                + key
                + '"\r\n\r\n'
                + str(value)
                + "\r\n"
            ).encode()
        )
    for index, (mime, raw) in enumerate(images):
        suffix = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[mime]
        field = "image" if len(images) == 1 else "image[]"
        chunks.append(
            (
                "--"
                + boundary
                + '\r\nContent-Disposition: form-data; name="'
                + field
                + '"; filename="reference-'
                + str(index)
                + "."
                + suffix
                + '"\r\nContent-Type: '
                + mime
                + "\r\n\r\n"
            ).encode()
            + raw
            + b"\r\n"
        )
    chunks.append(("--" + boundary + "--\r\n").encode())
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@security_server.bounded
def request_image(provider, args, config, images=None):
    prompt = args.get("prompt")
    size = args.get("size", "1024x1024")
    if not isinstance(size, str):
        raise ValueError("图片尺寸无效")
    size = size.replace("*", "x").replace("×", "x")
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 12000:
        raise ValueError("生图提示词需为 1–12000 字符")
    if not re.fullmatch(r"[0-9]{3,4}x[0-9]{3,4}", size) or any(
        not 256 <= int(value) <= 4096 or int(value) % 8 for value in size.split("x")
    ):
        raise ValueError("图片尺寸需为 256–4096 且为 8 的倍数")
    body = {"model": provider["model"], "prompt": prompt, "n": 1, "size": size}
    for key in ("quality", "background"):
        if key in args:
            if args[key] not in IMAGE_PARAMETERS["properties"][key]["enum"]:
                raise ValueError("生图参数无效：" + key)
            body[key] = args[key]
    if not provider["model"].lower().startswith("gpt-image"):
        body["response_format"] = "b64_json"
    headers = {"Content-Type": "application/json"}
    key = provider.get("api_key", "")
    if not isinstance(key, str) or "\r" in key or "\n" in key:
        raise ValueError("生图密钥格式无效")
    if key:
        headers["Authorization"] = "Bearer " + key
    raw_body = json.dumps(body).encode()
    endpoint = "/images/generations"
    if images:
        endpoint = "/images/edits"
        raw_body, headers["Content-Type"] = multipart(body, images)
    task_control.check(config)
    request = Request(provider["base_url"] + endpoint, data=raw_body, headers=headers)
    token = config.get("_cancel_token")
    try:
        with security_net.opener(
            NoRedirect(), allow_private=provider.get("allow_private_network", False)
        ).open(request, timeout=provider.get("timeout", 180)) as response:
            from contextlib import ExitStack

            with ExitStack() as resources:
                if token:
                    resources.enter_context(
                        token.resource(lambda: task_control.close_response(response))
                    )
                raw = response.read(12_000_001)
                if len(raw) > 12_000_000:
                    raise ValueError("生图响应超过限制")
                result = json.loads(raw)
                config["_reported_usage"] = result.get("usage")
        image = result["data"][0]
        if image.get("b64_json"):
            return base64.b64decode(image["b64_json"], validate=True)
        url = image.get("url", "")
        parsed = urlsplit(url)
        origin = urlsplit(provider["base_url"])
        same_origin = (parsed.scheme, parsed.hostname, parsed.port) == (
            origin.scheme,
            origin.hostname,
            origin.port,
        )
        if not same_origin and parsed.scheme != "https":
            raise ValueError("图片下载需要 HTTPS")
        # Download with no provider Authorization header, pinning DNS and prohibiting redirects.
        with security_net.opener(
            NoRedirect(),
            allow_private=bool(same_origin and provider.get("allow_private_network")),
            allow_query=True,
            allow_loopback=same_origin,
        ).open(url, timeout=60) as response:
            with ExitStack() as resources:
                if token:
                    resources.enter_context(
                        token.resource(lambda: task_control.close_response(response))
                    )
                raw = response.read(attachments.MAX_FILE + 1)
        return raw
    except HTTPError as error:
        code = error.code
        error.close()
        raise ValueError("生图服务返回 HTTP " + str(code)) from None
    except (URLError, TimeoutError):
        raise ValueError("生图服务连接失败或超时") from None
    except (ValueError, UnicodeError):
        raise ValueError("生图响应、下载地址或内容无效") from None
    except (KeyError, IndexError, TypeError):
        raise ValueError("生图服务响应格式无效") from None


def execute(args, config, context, name=None):
    providers = [
        p for p in context["providers"]() if model_catalog.supports(p, "image")
    ]
    if name == "list_image_models":
        return {
            "providers": [
                {
                    "id": p["id"],
                    "name": p.get("name", p["id"]),
                    "model": p.get("model", ""),
                    "models": p.get("models", []),
                }
                for p in providers
            ]
        }
    if args.get("model") and not args.get("provider"):
        providers = [
            p
            for p in providers
            if args["model"]
            in {p.get("model"), *(m["id"] for m in p.get("models", []))}
        ]
    if args.get("provider"):
        providers = [p for p in providers if p["id"] == args["provider"]]
    if not providers:
        raise ValueError("请先在服务商中添加 image_api 类型与图片模型")
    provider = dict(providers[0])
    if not args.get("model"):
        image_model = next(
            (
                model["id"]
                for model in provider.get("models", [])
                if model.get("kind") == "image"
            ),
            None,
        )
        if image_model:
            provider["model"] = image_model
    if args.get("model"):
        if not isinstance(args["model"], str) or args["model"] not in {
            provider.get("model"),
            *(m["id"] for m in provider.get("models", [])),
        }:
            raise ValueError("请先在图片服务商中添加此模型")
        provider["model"] = args["model"]
    images = reference_images(args, config, context)
    if not provider.get("base_url") or not provider.get("model"):
        raise ValueError("请完善图片服务商的地址与模型配置")
    runtime = {**provider, "_cancel_token": config.get("_cancel_token")}
    raw = task_control.io_call(
        config.get("_cancel_token"),
        lambda: usage_meter.metered(
            context["data"],
            runtime,
            lambda call_config: (
                request_image(provider, args, call_config, images)
                if images
                else request_image(provider, args, call_config)
            ),
        ),
    )
    task_control.check(config)
    name = (
        "generated.png"
        if raw.startswith(b"\x89PNG")
        else "generated.jpg" if raw.startswith(b"\xff\xd8") else "generated.webp"
    )
    item = attachments.upload(
        context["data"], {"name": name, "data": base64.b64encode(raw).decode()}
    )
    sid = config.get("_session_id")
    try:
        task_control.check(config)
        if sid:
            with context["database"]() as db:
                db.execute(
                    "INSERT INTO session_outputs(session_id,attachment_id) VALUES(?,?)",
                    (sid, item["id"]),
                )
    except BaseException:
        import shutil

        folder = attachments.location(context["data"], item["id"])
        shutil.rmtree(folder)
        raise
    url = "/api/attachments/" + item["id"] + "/content"
    return {
        "ok": True,
        "attachment": item,
        "url": url,
        "markdown": "![生成的图片](" + url + ")",
        "provider": provider["id"],
        "model": provider["model"],
        "reference_count": len(images),
    }
