"""Shared LLM text -> Pydantic-model parser (FR-4.1 edge handling).

Used by BOTH Stage 1 (vision) and Stage 4 (Ultra):
- strips markdown fences / surrounding prose
- validates against a strict Pydantic v2 schema
- performs ONE automatic repair retry with the exact validation error
- raises (typed, loud) when the model cannot be trusted after the retry
"""

from __future__ import annotations

import json
import re
from typing import Callable, Type, TypeVar

from pydantic import BaseModel, ValidationError

ModelT = TypeVar("ModelT", bound=BaseModel)

_FENCE_RE = re.compile(r"```(?:json)?\s*(.+?)```", re.DOTALL)
_FIRST_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)

MAX_JSON_REPAIR_RETRIES = 1


class LlmUnverifiableError(RuntimeError):
    """Stage output could not be coerced into the strict schema after retry."""


def strip_markdown_fences(text: str) -> str:
    """Return the most likely bare JSON substring of an LLM response."""
    fence = _FENCE_RE.search(text)
    if fence:
        text = fence.group(1).strip()
    else:
        obj = _FIRST_OBJ_RE.search(text)
        if obj:
            text = obj.group(0)
    try:
        json.loads(text)
        return text
    except json.JSONDecodeError:
        salvage = _first_balanced_object(text)
        return salvage if salvage is not None else text


def _first_balanced_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for idx in range(start, len(text)):
        if text[idx] == "{":
            depth += 1
        elif text[idx] == "}":
            depth -= 1
            if depth == 0:
                return text[start : idx + 1]
    return None


def parse_llm_json(
    raw_text: str,
    schema: Type[ModelT],
    retry_call: Callable[[str], str] | None = None,
) -> ModelT:
    """Validate an LLM completion; on schema failure optionally re-ask once.

    retry_call(original_prompt_free_text) -> new completion text. When None or
    exhausted, raise LlmUnverifiableError carrying every error message.
    """
    errors: list[str] = []
    attempt = strip_markdown_fences(raw_text)
    model = None
    for round_index in range(MAX_JSON_REPAIR_RETRIES + 1):
        try:
            model = schema.model_validate_json(attempt)
            break
        except (ValidationError, json.JSONDecodeError) as exc:
            errors.append(str(exc))

            if round_index >= MAX_JSON_REPAIR_RETRIES or retry_call is None:
                continue
            error_text = errors[-1]
            attempt = strip_markdown_fences(retry_call(error_text))
    if model is None:
        raise LlmUnverifiableError("; ".join(errors) or "empty completion")
    return model
