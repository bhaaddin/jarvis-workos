"""Small, bounded decimal calculator for verified numerical assistant answers."""
import ast
from decimal import Decimal, DecimalException, Inexact, localcontext

from .projects import ProjectError


def calculate(expression):
    if not isinstance(expression, str) or not 1 <= len(expression.strip()) <= 500:
        raise ProjectError('Enter an arithmetic expression of 1-500 characters.')
    expression = expression.strip()
    try:
        tree = ast.parse(expression, mode='eval')
        if sum(1 for _ in ast.walk(tree)) > 100:
            raise ValueError('Expression is too complex.')

        def evaluate(node):
            if isinstance(node, ast.Constant) and type(node.value) in (int, float):
                result = Decimal(ast.get_source_segment(expression, node))
            elif isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
                value = evaluate(node.operand)
                result = value if isinstance(node.op, ast.UAdd) else -value
            elif isinstance(node, ast.BinOp):
                left, right = evaluate(node.left), evaluate(node.right)
                if isinstance(node.op, ast.Add): result = left + right
                elif isinstance(node.op, ast.Sub): result = left - right
                elif isinstance(node.op, ast.Mult): result = left * right
                elif isinstance(node.op, ast.Div): result = left / right
                elif isinstance(node.op, ast.Mod): result = left % right
                elif isinstance(node.op, ast.Pow) and right == right.to_integral_value() and abs(right) <= 12:
                    result = left ** int(right)
                else: raise ValueError('Unsupported operator or exponent.')
            else:
                raise ValueError('Only numbers, arithmetic operators, and parentheses are accepted.')
            if not result.is_finite() or abs(result.adjusted()) > 100:
                raise ValueError('Value is outside the calculator range.')
            return result

        with localcontext() as context:
            context.prec = 50
            value = evaluate(tree.body)
            return {'expression': expression, 'value': str(value), 'precision_digits': 50, 'rounded': context.flags[Inexact]}
    except (SyntaxError, ValueError, DecimalException, RecursionError) as error:
        raise ProjectError('Invalid arithmetic expression: use bounded decimal arithmetic, without code or names.') from error
