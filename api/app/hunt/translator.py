"""
HQL AST translators.

  to_clickhouse_sql(ast) → SQL WHERE clause string for ClickHouse
  to_predicate(ast)      → Python callable (event_dict -> bool) for in-memory store
"""
from __future__ import annotations

import fnmatch
import json
import re
from typing import Any, Callable

from app.hunt.parser import ASTNode, BoolNode, MultiValueNode, NotNode, TermNode

# ---------------------------------------------------------------------------
# ClickHouse SQL translator
# ---------------------------------------------------------------------------

# Fields stored as top-level integer in the JSON event object.
# For these we try integer comparison first (faster in CH).
_INTEGER_FIELDS = {"event_id", "record_id", "process_id", "pid"}

# The source column is a real ClickHouse column, not inside the JSON blob.
_SOURCE_COLUMN_FIELD = "source"


def to_clickhouse_sql(ast: ASTNode) -> str:
    """Return a ClickHouse SQL fragment suitable for use in a WHERE clause."""
    if isinstance(ast, TermNode):
        return _ch_term(ast)
    if isinstance(ast, MultiValueNode):
        return _ch_multi(ast)
    if isinstance(ast, BoolNode):
        left = to_clickhouse_sql(ast.left)
        right = to_clickhouse_sql(ast.right)
        return f"({left} {ast.op} {right})"
    if isinstance(ast, NotNode):
        inner = to_clickhouse_sql(ast.operand)
        return f"(NOT {inner})"
    raise TypeError(f"Unknown AST node type: {type(ast)}")


def _ch_term(node: TermNode) -> str:
    if node.field is None:
        # Full-text substring — use positionCaseInsensitive for speed
        safe = _ch_str(node.value)
        return f"positionCaseInsensitive(event, {safe}) > 0"

    field = node.field
    value = node.value

    # Source column (indexed primary key)
    if field == _SOURCE_COLUMN_FIELD:
        if node.wildcard:
            return f"source LIKE {_ch_str(value.replace('*', '%'))}"
        return f"source = {_ch_str(value)}"

    path_parts = field.split(".")

    # Integer extraction (event_id etc.)
    if field in _INTEGER_FIELDS and not node.wildcard and re.fullmatch(r"\d+", value):
        ch_path = ", ".join(f"'{p}'" for p in path_parts)
        return f"JSONExtractUInt(event, {ch_path}) = {int(value)}"

    # String extraction with optional wildcard
    ch_path = ", ".join(f"'{p}'" for p in path_parts)
    if node.wildcard:
        like_val = value.replace("%", r"\%").replace("*", "%")
        return f"lower(JSONExtractString(event, {ch_path})) LIKE lower({_ch_str(like_val)})"
    return (
        f"lower(JSONExtractString(event, {ch_path})) = lower({_ch_str(value)})"
    )


def _ch_multi(node: MultiValueNode) -> str:
    field = node.field

    if field == _SOURCE_COLUMN_FIELD:
        vals = ", ".join(_ch_str(v) for v in node.values)
        return f"source IN ({vals})"

    path_parts = field.split(".")

    # All-integer multi-value (event_id:(4625 OR 4648))
    if field in _INTEGER_FIELDS and all(re.fullmatch(r"\d+", v) for v in node.values):
        ch_path = ", ".join(f"'{p}'" for p in path_parts)
        vals = ", ".join(node.values)
        return f"JSONExtractUInt(event, {ch_path}) IN ({vals})"

    ch_path = ", ".join(f"'{p}'" for p in path_parts)
    vals = ", ".join(_ch_str(v) for v in node.values)
    return f"lower(JSONExtractString(event, {ch_path})) IN ({', '.join(_ch_str(v.lower()) for v in node.values)})"


def _ch_str(s: str) -> str:
    escaped = s.replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"


# ---------------------------------------------------------------------------
# Python predicate translator (in-memory store)
# ---------------------------------------------------------------------------

Predicate = Callable[[dict], bool]


def to_predicate(ast: ASTNode) -> Predicate:
    """Return a Python callable (event_dict -> bool) for in-memory filtering."""
    if isinstance(ast, TermNode):
        return _py_term(ast)
    if isinstance(ast, MultiValueNode):
        return _py_multi(ast)
    if isinstance(ast, BoolNode):
        left_fn = to_predicate(ast.left)
        right_fn = to_predicate(ast.right)
        if ast.op == "AND":
            return lambda ev, l=left_fn, r=right_fn: l(ev) and r(ev)
        return lambda ev, l=left_fn, r=right_fn: l(ev) or r(ev)
    if isinstance(ast, NotNode):
        inner_fn = to_predicate(ast.operand)
        return lambda ev, f=inner_fn: not f(ev)
    raise TypeError(f"Unknown AST node type: {type(ast)}")


def _py_term(node: TermNode) -> Predicate:
    value_lower = node.value.lower()

    if node.field is None:
        # Full-text: search serialised event JSON
        return lambda ev, v=value_lower: v in json.dumps(ev, default=str).lower()

    field = node.field

    def match(ev_dict: dict, f=field, v=value_lower, wc=node.wildcard) -> bool:
        actual = _get_field(ev_dict, f)
        if actual is None:
            return False
        actual_str = str(actual).lower()
        if wc:
            return fnmatch.fnmatch(actual_str, v)
        return actual_str == v

    return match


def _py_multi(node: MultiValueNode) -> Predicate:
    values_lower = {v.lower() for v in node.values}
    field = node.field

    def match(ev_dict: dict, f=field, vs=values_lower) -> bool:
        actual = _get_field(ev_dict, f)
        if actual is None:
            return False
        return str(actual).lower() in vs

    return match


def _get_field(ev_dict: Any, field_path: str) -> Any:
    """Walk a dotted field path (e.g. 'event_data.SubjectUserName') into a dict."""
    val: Any = ev_dict
    for part in field_path.split("."):
        if not isinstance(val, dict):
            return None
        val = val.get(part)
        if val is None:
            return None
    return val
