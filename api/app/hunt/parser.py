"""
Vigil Hunt Query Language (HQL) — Lexer and Parser.

Grammar (EBNF):
    query    ::= or_expr
    or_expr  ::= and_expr ("OR" and_expr)*
    and_expr ::= not_expr ("AND" not_expr)*
    not_expr ::= "NOT" not_expr | atom
    atom     ::= "(" query ")" | field_expr | term
    field_expr ::= WORD ":" value_expr
    value_expr ::= "(" multi_or ")" | VALUE
    multi_or ::= VALUE ("OR" VALUE)*
    term     ::= WORD | QUOTED

Syntax examples:
    event_id:4625
    event_id:(4625 OR 4648)
    event_data.IpAddress:10.0.*
    source:winlog:Security
    event_id:4625 AND event_data.LogonType:3
    NOT event_data.SubjectUserName:SYSTEM$
    (event_id:4625 OR event_id:4648) AND NOT event_data.SubjectUserName:SYSTEM$
    mshta.exe                                # bare text → full-text substring
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Union


# ---------------------------------------------------------------------------
# AST
# ---------------------------------------------------------------------------

@dataclass
class TermNode:
    """Single field:value pair or a bare full-text term (field=None)."""
    field: str | None        # None → full-text substring search
    value: str
    wildcard: bool = False   # True when value contains *


@dataclass
class MultiValueNode:
    """field:(v1 OR v2 OR v3) — logical OR across a fixed value set."""
    field: str
    values: list[str]


@dataclass
class BoolNode:
    """Binary boolean operator."""
    op: str   # 'AND' | 'OR'
    left: "ASTNode"
    right: "ASTNode"


@dataclass
class NotNode:
    """Logical negation."""
    operand: "ASTNode"


ASTNode = Union[TermNode, MultiValueNode, BoolNode, NotNode]


# ---------------------------------------------------------------------------
# Token
# ---------------------------------------------------------------------------

@dataclass
class Token:
    type: str    # AND | OR | NOT | LPAREN | RPAREN | WORD | QUOTED | EOF
    value: str


_KEYWORDS = {"AND", "OR", "NOT"}


# ---------------------------------------------------------------------------
# Lexer
# ---------------------------------------------------------------------------

def tokenize(query: str) -> list[Token]:
    """Convert an HQL string into a flat list of tokens."""
    tokens: list[Token] = []
    i = 0
    n = len(query)

    while i < n:
        # Skip whitespace
        while i < n and query[i] in " \t\n\r":
            i += 1
        if i >= n:
            break

        c = query[i]

        if c == "(":
            tokens.append(Token("LPAREN", "("))
            i += 1
        elif c == ")":
            tokens.append(Token("RPAREN", ")"))
            i += 1
        elif c == '"':
            # Quoted string — supports \" inside
            j = i + 1
            buf: list[str] = []
            while j < n and query[j] != '"':
                if query[j] == "\\" and j + 1 < n:
                    buf.append(query[j + 1])
                    j += 2
                else:
                    buf.append(query[j])
                    j += 1
            tokens.append(Token("QUOTED", "".join(buf)))
            i = j + 1
        else:
            # Read until whitespace or paren
            j = i
            while j < n and query[j] not in " \t\n\r()":
                j += 1
            word = query[i:j]
            i = j
            if word.upper() in _KEYWORDS:
                tokens.append(Token(word.upper(), word))
            else:
                tokens.append(Token("WORD", word))

    tokens.append(Token("EOF", ""))
    return tokens


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

class HQLParser:
    def __init__(self, tokens: list[Token]):
        self._tokens = tokens
        self._pos = 0

    def _peek(self) -> Token:
        return self._tokens[self._pos]

    def _consume(self, expected_type: str | None = None) -> Token:
        tok = self._tokens[self._pos]
        if expected_type and tok.type != expected_type:
            raise ValueError(
                f"Expected {expected_type} but got {tok.type!r} ({tok.value!r})"
            )
        self._pos += 1
        return tok

    def parse(self) -> ASTNode | None:
        if self._peek().type == "EOF":
            return None
        node = self._parse_or()
        if self._peek().type != "EOF":
            raise ValueError(
                f"Unexpected token after query: {self._peek().value!r}"
            )
        return node

    # ------------------------------------------------------------------
    # Recursive descent
    # ------------------------------------------------------------------

    def _parse_or(self) -> ASTNode:
        left = self._parse_and()
        while self._peek().type == "OR":
            self._consume("OR")
            right = self._parse_and()
            left = BoolNode("OR", left, right)
        return left

    def _parse_and(self) -> ASTNode:
        left = self._parse_not()
        while self._peek().type == "AND":
            self._consume("AND")
            right = self._parse_not()
            left = BoolNode("AND", left, right)
        return left

    def _parse_not(self) -> ASTNode:
        if self._peek().type == "NOT":
            self._consume("NOT")
            operand = self._parse_not()
            return NotNode(operand)
        return self._parse_atom()

    def _parse_atom(self) -> ASTNode:
        tok = self._peek()

        if tok.type == "LPAREN":
            self._consume("LPAREN")
            node = self._parse_or()
            self._consume("RPAREN")
            return node

        if tok.type == "QUOTED":
            self._consume("QUOTED")
            return TermNode(field=None, value=tok.value, wildcard=False)

        if tok.type == "WORD":
            self._consume("WORD")
            word = tok.value

            # Check for field:value pattern (split on FIRST colon only)
            colon = word.find(":")
            if colon > 0:
                field_name = word[:colon]
                value_part = word[colon + 1:]

                if value_part:
                    # field:value — value may itself contain colons (e.g. source:winlog:Security)
                    return TermNode(
                        field=field_name,
                        value=value_part,
                        wildcard="*" in value_part,
                    )
                else:
                    # field: followed by ( → multi-value  e.g. event_id:(4625 OR 4648)
                    if self._peek().type == "LPAREN":
                        return self._parse_multi_value(field_name)
                    # field: with nothing after — treat as full-text bare term
                    return TermNode(field=None, value=word, wildcard=False)

            # Bare term — full-text substring search
            return TermNode(field=None, value=word, wildcard="*" in word)

        raise ValueError(
            f"Unexpected token {tok.type!r} ({tok.value!r}) in query"
        )

    def _parse_multi_value(self, field_name: str) -> ASTNode:
        """Parse field:(v1 OR v2 OR v3)."""
        self._consume("LPAREN")
        values = [self._parse_bare_value()]
        while self._peek().type == "OR":
            self._consume("OR")
            values.append(self._parse_bare_value())
        self._consume("RPAREN")
        if len(values) == 1:
            return TermNode(field=field_name, value=values[0], wildcard="*" in values[0])
        return MultiValueNode(field=field_name, values=values)

    def _parse_bare_value(self) -> str:
        tok = self._peek()
        if tok.type in ("WORD", "QUOTED"):
            self._consume()
            return tok.value
        raise ValueError(f"Expected a value, got {tok.type!r} ({tok.value!r})")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def parse_hql(query: str) -> ASTNode | None:
    """Parse an HQL query string into an AST. Returns None for empty query."""
    query = query.strip()
    if not query:
        return None
    tokens = tokenize(query)
    return HQLParser(tokens).parse()
