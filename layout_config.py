"""Declarative home layouts, navigation shortcuts and composable skin modules."""

import copy
import re

BLOCKS = {"greeting", "hint", "starters", "shortcuts"}
BUTTONS = {
    "home",
    "images",
    "schedule",
    "library",
    "plugins",
    "more",
    "review",
    "settings",
    "profile",
}
ICONS = BUTTONS | {"canvas", "search", "theme"}
ACTIONS = BUTTONS - {"more"} | {
    "canvas",
    "projects",
    "archives",
    "theme",
    "appearance",
    "performance",
    "layout",
    "files",
    "new_chat",
    "prompt",
}
DEFAULT = {
    "enabled": False,
    "home_order": ["greeting", "hint", "starters", "shortcuts"],
    "home_hidden": [],
    "home_align": "center",
    "home_width": 840,
    "home_columns": 3,
    "home_title": "",
    "composer_position": "bottom",
    "sidebar_order": ["home", "images", "library", "more", "settings", "profile"],
    "sidebar_bottom": ["settings", "profile"],
    "sidebar_names": {},
    "sidebar_labels": False,
    "home_shortcuts": [],
    "shortcuts": [],
}


def text(value, limit, empty=True):
    if not isinstance(value, str) or len(value) > limit or (not empty and not value.strip()):
        raise ValueError("布局或模组文字格式无效")
    return value


def identifiers(value, allowed):
    if (
        not isinstance(value, list)
        or any(not isinstance(item, str) or item not in allowed for item in value)
        or len(set(value)) != len(value)
    ):
        raise ValueError("布局项目无效或重复")
    return list(value)


def validate(value):
    if not isinstance(value, dict) or set(value) - set(DEFAULT):
        raise ValueError("布局配置字段无效")
    result = copy.deepcopy(DEFAULT)
    result.update(value)
    for key in ("enabled", "sidebar_labels"):
        if type(result[key]) is not bool:
            raise ValueError("布局开关无效")
    for key, low, high in [("home_width", 480, 1200), ("home_columns", 1, 4)]:
        if type(result[key]) is not int or not low <= result[key] <= high:
            raise ValueError("布局数值超出范围")
    if result["home_align"] not in ("left", "center") or result["composer_position"] not in (
        "bottom",
        "center",
    ):
        raise ValueError("布局位置无效")
    result["home_title"] = text(result["home_title"], 200)
    shortcuts = result["shortcuts"]
    if not isinstance(shortcuts, list) or len(shortcuts) > 20:
        raise ValueError("快捷入口最多 20 项")
    known = set(BUTTONS)
    for shortcut in shortcuts:
        if not isinstance(shortcut, dict) or set(shortcut) - {
            "id",
            "label",
            "icon",
            "action",
            "prompt",
        }:
            raise ValueError("快捷入口字段无效")
        ident = shortcut.get("id")
        if (
            not isinstance(ident, str)
            or not re.fullmatch(r"custom-[a-z0-9-]{1,48}", ident)
            or ident in known
        ):
            raise ValueError("快捷入口 ID 无效或重复")
        known.add(ident)
        text(shortcut.get("label"), 60, False)
        if shortcut.get("icon") not in ICONS or shortcut.get("action") not in ACTIONS:
            raise ValueError("快捷入口动作或图标无效")
        text(shortcut.get("prompt", ""), 4000, shortcut.get("action") != "prompt")
    names = result["sidebar_names"]
    if not isinstance(names, dict) or set(names) - known:
        raise ValueError("导航名称配置无效")
    result["sidebar_names"] = {key: text(label, 60, False) for key, label in names.items()}
    result["shortcuts"] = copy.deepcopy(shortcuts)
    for key in ("home_order", "home_hidden"):
        result[key] = identifiers(result[key], BLOCKS)
    if set(result["home_order"]) != BLOCKS:
        raise ValueError("主页区块顺序需包含全部区块")
    for key in ("sidebar_order", "sidebar_bottom", "home_shortcuts"):
        result[key] = identifiers(result[key], known)
    if "more" in result["home_shortcuts"]:
        raise ValueError("更多菜单不能作为主页快捷入口")
    return result


def modules(value, validate_settings):
    if not isinstance(value, list) or len(value) > 32:
        raise ValueError("皮肤模组最多 32 项")
    result = []
    seen = set()
    for item in value:
        if not isinstance(item, dict) or set(item) - {
            "id",
            "name",
            "version",
            "author",
            "description",
            "enabled",
            "settings",
        }:
            raise ValueError("模组字段无效")
        ident = item.get("id")
        if (
            not isinstance(ident, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", ident)
            or ident in seen
        ):
            raise ValueError("模组 ID 无效或重复")
        seen.add(ident)
        if type(item.get("enabled", True)) is not bool:
            raise ValueError("模组开关无效")
        settings = item.get("settings", {})
        if (
            not isinstance(settings, dict)
            or not settings
            or set(settings) - {"background", "styles", "icons", "layout"}
        ):
            raise ValueError("模组设置需包含背景、样式、图标或布局")
        clean = validate_settings(settings)
        patch = {}
        for group, fields in settings.items():
            if not isinstance(fields, dict):
                raise ValueError("模组配置分组无效")
            patch[group] = {key: clean[group][key] for key in fields}
        result.append(
            {
                "id": ident,
                "name": text(item.get("name"), 100, False),
                "version": text(item.get("version", "1.0.0"), 40, False),
                "author": text(item.get("author", ""), 80),
                "description": text(item.get("description", ""), 1000),
                "enabled": item.get("enabled", True),
                "settings": patch,
            }
        )
    return result
