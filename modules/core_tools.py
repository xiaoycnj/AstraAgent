"""Bounded calculator and local clock."""
import ast
import operator
from datetime import datetime

DEFINITIONS = [
 {'type':'function','function':{'name':'calculator','description':'安全计算数学表达式，支持 + - * / 和括号','parameters':{'type':'object','properties':{'expression':{'type':'string'}},'required':['expression'],'additionalProperties':False}}},
 {'type':'function','function':{'name':'current_time','description':'获取本机当前时间及其时区偏移','parameters':{'type':'object','properties':{},'additionalProperties':False}}}
]

def run_tool(name, args):
    if name == 'current_time': return {'time':datetime.now().astimezone().isoformat()}
    expression = args['expression']
    if not isinstance(expression,str) or len(expression)>200: raise ValueError()
    try: tree = ast.parse(expression, mode='eval')
    except SyntaxError: raise ValueError() from None
    if len(list(ast.walk(tree)))>64: raise ValueError()
    ops = {ast.Add:operator.add,ast.Sub:operator.sub,ast.Mult:operator.mul,ast.Div:operator.truediv}
    def calc(n):
        if isinstance(n,ast.Constant) and type(n.value) in (int,float) and abs(n.value)<1e100: return n.value
        if isinstance(n,ast.UnaryOp) and isinstance(n.op,(ast.USub,ast.UAdd)): return (-1 if isinstance(n.op,ast.USub) else 1)*calc(n.operand)
        if isinstance(n,ast.BinOp) and type(n.op) in ops:
            value=ops[type(n.op)](calc(n.left),calc(n.right))
            if abs(value)>1e100: raise ValueError()
            return value
        raise ValueError()
    try: return {'result':calc(tree.body)}
    except SyntaxError: raise ValueError() from None


def execute(args,config,context,name):return run_tool(name,args)
