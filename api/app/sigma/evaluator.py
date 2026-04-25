"""
Pure-Python Sigma rule evaluator.

Operates on a pre-parsed detection block (dict) and a flat event dict.
Never raises — all errors return False.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def evaluate(rule: dict, event: dict) -> bool:
    """Return True if *event* matches the Sigma rule's detection block.

    *rule* is the ``parsed_detection`` dict stored in the rule cache — it is
    the raw Python dict from parsing the Sigma YAML's ``detection:`` section,
    plus an optional ``condition:`` key.

    Never raises.
    """
    try:
        return _evaluate(rule, event)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            '{"event": "sigma_eval_error", "error": "%s"}',
            str(exc).replace('"', "'"),
        )
        return False


# ---------------------------------------------------------------------------
# Core evaluation
# ---------------------------------------------------------------------------

def _evaluate(detection: dict, event: dict) -> bool:
    detection_results: dict[str, bool] = {}

    for key, value in detection.items():
        if key == "condition":
            continue
        detection_results[key] = _evaluate_block(key, value, event)

    condition_str = detection.get("condition", "")
    if not condition_str:
        # No explicit condition — AND all named blocks
        return all(detection_results.values()) if detection_results else False

    condition_fn = _parse_condition(condition_str.strip())
    return condition_fn(detection_results)


def _evaluate_block(key: str, block: Any, event: dict) -> bool:
    """Evaluate a single detection block (keywords list or field-match dict)."""
    if key == "keywords":
        return _eval_keywords(block, event)
    if isinstance(block, dict):
        return _eval_selection(block, event)
    if isinstance(block, list):
        # A list of dicts — OR across the list items
        return any(_eval_selection(item, event) for item in block if isinstance(item, dict))
    return False


def _eval_keywords(keywords: Any, event: dict) -> bool:
    """Match any keyword as a substring of the JSON-encoded event (case-insensitive)."""
    if not isinstance(keywords, list):
        keywords = [keywords]
    haystack = json.dumps(event).lower()
    return any(str(kw).lower() in haystack for kw in keywords)


def _eval_selection(selection: dict, event: dict) -> bool:
    """Evaluate a field-match dict.  All fields must match (AND across fields)."""
    for field_modifier, expected in selection.items():
        field, modifier = _split_modifier(field_modifier)
        actual = _resolve_field(field, event)
        if not _match_value(actual, modifier, expected):
            return False
    return True


# ---------------------------------------------------------------------------
# Field resolution
# ---------------------------------------------------------------------------

def _resolve_field(field: str, event: dict) -> Any:
    """Resolve a (possibly dotted) field name from the event dict."""
    # Try direct key first
    if field in event:
        return event[field]

    # Dot-notation: one level deep
    if "." in field:
        parent, child = field.split(".", 1)
        parent_val = event.get(parent, {})
        if isinstance(parent_val, dict):
            if child in parent_val:
                return parent_val[child]
            # camelCase / snake_case fallbacks
            for variant in _name_variants(child):
                if variant in parent_val:
                    return parent_val[variant]

    # Top-level camelCase / snake_case fallbacks
    for variant in _name_variants(field):
        if variant in event:
            return event[variant]

    return None


def _name_variants(name: str) -> list[str]:
    """Return camelCase and snake_case variants of *name*."""
    variants = []
    # snake_case → camelCase
    parts = name.split("_")
    if len(parts) > 1:
        camel = parts[0] + "".join(p.title() for p in parts[1:])
        variants.append(camel)
    # camelCase → snake_case
    snake = re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()
    if snake != name:
        variants.append(snake)
    return variants


# ---------------------------------------------------------------------------
# Modifier parsing and value matching
# ---------------------------------------------------------------------------

_KNOWN_MODIFIERS = {"contains", "startswith", "endswith", "re", "all", "windash"}


def _split_modifier(field_modifier: str) -> tuple[str, str | None]:
    """Split ``CommandLine|contains`` into ``('CommandLine', 'contains')``."""
    if "|" in field_modifier:
        parts = field_modifier.split("|", 1)
        return parts[0], parts[1].lower()
    return field_modifier, None


def _match_value(actual: Any, modifier: str | None, expected: Any) -> bool:
    """Match *actual* against *expected* using the given modifier."""
    # Normalise expected to a list for uniform handling (OR across values)
    if not isinstance(expected, list):
        expected_list = [expected]
    else:
        expected_list = expected

    # Handle 'all' modifier — every value must match.
    # Sigma allows both `field|all|contains` and `field|contains|all` orderings.
    require_all = False
    base_modifier = modifier
    if modifier:
        parts = modifier.split("|")
        if "all" in parts:
            require_all = True
            parts = [p for p in parts if p != "all"]
        base_modifier = "|".join(parts) if parts else None

    def _single_match(exp_val: Any) -> bool:
        return _match_single(actual, base_modifier, exp_val)

    if require_all:
        return all(_single_match(v) for v in expected_list)
    return any(_single_match(v) for v in expected_list)


def _match_single(actual: Any, modifier: str | None, expected: Any) -> bool:
    """Match one actual value against one expected value with a modifier."""
    # Wildcard-only value means "field exists"
    if expected == "*":
        return actual is not None

    actual_str = str(actual).lower() if actual is not None else ""
    expected_str = str(expected).lower()

    if modifier is None:
        # Exact match, case-insensitive; treat trailing/leading * as wildcards
        if "*" in expected_str:
            pattern = re.escape(expected_str).replace(r"\*", ".*")
            return re.fullmatch(pattern, actual_str) is not None
        return actual_str == expected_str

    if modifier == "contains":
        return expected_str in actual_str

    if modifier == "startswith":
        return actual_str.startswith(expected_str)

    if modifier == "endswith":
        return actual_str.endswith(expected_str)

    if modifier in ("re", "regex"):
        try:
            return bool(re.search(str(expected), str(actual) if actual is not None else "", re.IGNORECASE))
        except re.error:
            return False

    if modifier == "windash":
        # Match with both - and / prefixes
        stripped = expected_str.lstrip("-/")
        return actual_str in (f"-{stripped}", f"/{stripped}", stripped)

    # Unknown modifier — fall back to substring
    return expected_str in actual_str


# ---------------------------------------------------------------------------
# Condition parser — recursive descent
# ---------------------------------------------------------------------------

def _parse_condition(condition: str) -> "_ConditionFn":
    """Parse a Sigma condition string into a callable.

    The callable takes ``detection_results: dict[str, bool]`` and returns bool.
    """
    tokens = _tokenise(condition)
    parser = _ConditionParser(tokens)
    return parser.parse()


_ConditionFn = Any  # Callable[[dict[str, bool]], bool]


def _tokenise(condition: str) -> list[str]:
    tokens: list[str] = []
    i = 0
    s = condition
    while i < len(s):
        if s[i].isspace():
            i += 1
            continue
        if s[i] in "()":
            tokens.append(s[i])
            i += 1
            continue
        # Read a word
        j = i
        while j < len(s) and not s[j].isspace() and s[j] not in "()":
            j += 1
        tokens.append(s[i:j])
        i = j
    return tokens


class _ConditionParser:
    """Simple recursive-descent parser for Sigma condition strings."""

    def __init__(self, tokens: list[str]) -> None:
        self._tokens = tokens
        self._pos = 0

    # ---- public ----

    def parse(self) -> _ConditionFn:
        fn = self._parse_or()
        return fn

    # ---- grammar ----
    # expr  := or_expr
    # or    := and_expr ('OR' and_expr)*
    # and   := not_expr ('AND' not_expr)*
    # not   := 'NOT' primary | primary
    # primary := '(' expr ')' | quantifier | name

    def _parse_or(self) -> _ConditionFn:
        left = self._parse_and()
        while self._peek_upper() == "OR":
            self._consume()
            right = self._parse_and()
            left = _make_or(left, right)
        return left

    def _parse_and(self) -> _ConditionFn:
        left = self._parse_not()
        while self._peek_upper() == "AND":
            self._consume()
            right = self._parse_not()
            left = _make_and(left, right)
        return left

    def _parse_not(self) -> _ConditionFn:
        if self._peek_upper() == "NOT":
            self._consume()
            inner = self._parse_primary()
            return _make_not(inner)
        return self._parse_primary()

    def _parse_primary(self) -> _ConditionFn:
        tok = self._peek()
        if tok is None:
            return _const(False)

        if tok == "(":
            self._consume()  # '('
            fn = self._parse_or()
            if self._peek() == ")":
                self._consume()  # ')'
            return fn

        # Quantifier: "1 of <name>*" or "all of <name>*"
        if tok.lower() in ("1", "all") and self._peek_at(1) and self._peek_at(1).lower() == "of":
            quantifier = self._consume().lower()  # '1' or 'all'
            self._consume()  # 'of'
            pattern = self._consume()  # e.g. 'selection*' or 'filter*'
            return _make_quantifier(quantifier, pattern)

        # Bare name reference
        name = self._consume()
        return _make_ref(name)

    # ---- token helpers ----

    def _peek(self) -> str | None:
        if self._pos < len(self._tokens):
            return self._tokens[self._pos]
        return None

    def _peek_upper(self) -> str | None:
        t = self._peek()
        return t.upper() if t else None

    def _peek_at(self, offset: int) -> str | None:
        idx = self._pos + offset
        if idx < len(self._tokens):
            return self._tokens[idx]
        return None

    def _consume(self) -> str:
        tok = self._tokens[self._pos]
        self._pos += 1
        return tok


# ---- Callable factories ----

def _const(val: bool) -> _ConditionFn:
    return lambda _dr: val


def _make_ref(name: str) -> _ConditionFn:
    def _fn(dr: dict) -> bool:
        return bool(dr.get(name, False))
    return _fn


def _make_or(a: _ConditionFn, b: _ConditionFn) -> _ConditionFn:
    return lambda dr: a(dr) or b(dr)


def _make_and(a: _ConditionFn, b: _ConditionFn) -> _ConditionFn:
    return lambda dr: a(dr) and b(dr)


def _make_not(inner: _ConditionFn) -> _ConditionFn:
    return lambda dr: not inner(dr)


def _make_quantifier(quantifier: str, pattern: str) -> _ConditionFn:
    """Return a function that checks '1 of pattern*' or 'all of pattern*'."""
    # Convert glob pattern (trailing *) to a regex prefix
    if pattern.endswith("*"):
        prefix = pattern[:-1]
        def _matches_key(k: str) -> bool:
            return k.startswith(prefix)
    else:
        def _matches_key(k: str) -> bool:
            return k == pattern

    if quantifier == "1":
        def _fn(dr: dict) -> bool:
            return any(v for k, v in dr.items() if _matches_key(k))
    else:  # 'all'
        def _fn(dr: dict) -> bool:
            matching = [v for k, v in dr.items() if _matches_key(k)]
            return bool(matching) and all(matching)

    return _fn
