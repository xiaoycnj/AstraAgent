"""Server-side tool metadata. Unknown/new tools are external by default."""
INTERNAL = frozenset({'calculator','current_time','get_environment'})

def metadata(name):
    return {'provenance':'internal' if name in INTERNAL else 'external'}

def registry(definitions):
    return {item['function']['name']:metadata(item['function']['name']) for item in definitions}

def external(name):
    return metadata(name)['provenance']=='external'
