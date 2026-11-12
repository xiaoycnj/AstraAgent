# Language packs

Built-in packs are `zh-CN.json`, `en.json`, and `ja.json`. Choose a language or Follow system in Settings → General → Language. Selection is stored in `data/ui-preferences.json` and used by the desktop startup screen as well.

Copy `en.json`, change `code`, `name`, `locale` and the translated values, then place the file in this folder. Click Rescan language packs or restart. You can also import a JSON file in Settings. UTF-8 JSON packs are limited to 1.5 MB and 5,000 entries. Existing custom codes are replaced on import. The built-in codes are reserved.

```json
{
  "code": "fr-FR",
  "name": "Français",
  "locale": "fr-FR",
  "direction": "ltr",
  "messages": {
    "设置": "Paramètres",
    "常规": "Général",
    "语言": "Langue",
    "{0} 个文件变更": "{0} fichiers modifiés"
  }
}
```

Message keys are canonical Simplified Chinese UI strings. Preserve numbered placeholders such as `{0}`. Missing entries fall back to the source UI string. Pack text is inserted with DOM text APIs. HTML and scripts are not executed. User messages, model responses, code editors, file previews, terminal output, names and original license text are excluded from translation. Packs translate the application interface rather than model response language or user-authored content.

Use the model's custom instructions to choose its response language independently. Invalid packs are skipped and reported in Settings. No remote translation service is used.
