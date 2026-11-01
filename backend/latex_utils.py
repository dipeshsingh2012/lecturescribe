"""
LaTeX-aware JSON parsing and corrupted math formula recovery utilities.

Handles two common failure modes when LLMs emit LaTeX math inside JSON strings:
1. Unescaped backslashes that collide with valid JSON single-character control escapes
   (\\b, \\f, \\n, \\r, \\t), such as "\\theta" -> TAB + "heta", "\\times" -> TAB + "imes",
   "\\text" -> TAB + "ext", "\\frac" -> FORMFEED + "rac", "\\beta" -> BACKSPACE + "eta",
   "\\nabla" -> NEWLINE + "abla", "\\rho" -> CR + "ho".
2. Constrained JSON grammar decoders (response_format=json_object / responseMimeType=application/json)
   dropping the leading backslash on LaTeX commands that begin with non-JSON-escape letters
   inside $...$ math spans (e.g., emitting "eta" instead of "\\eta" in "$\\theta - eta \\times \\text{gradient}$").
"""
from __future__ import annotations

import json
import re
from typing import Any, Dict, Optional

_ASCII_WORD_RE = re.compile(r"[a-zA-Z]+")

# Tier 1: LaTeX commands starting with b, f, n, r, t that are unambiguous everywhere
# (their suffix after stripping the first letter is never a standalone English prose word
# following \n or \t, and \b / \f / bare \r never legitimately precede letters in JSON prose).
_UNAMBIGUOUS_B_SUFFIXES = (
    "ackepsilon", "ackprime", "acksim", "acksimeq", "ackslash",
    "ar", "arwedge", "ecause", "egin", "eta", "eth", "etween",
    "f", "fseries",
    "ig", "igcap", "igcup", "igg", "iggl", "iggm", "iggr",
    "igl", "igm", "igodot", "igoplus", "igotimes", "igr",
    "igsqcup", "igtriangledown", "igtriangleup", "iguplus", "igvee", "igwedge",
    "inom", "lacklozenge", "lacksquare", "lacktriangle", "lacktriangledown",
    "lacktriangleleft", "lacktriangleright",
    "m", "mod", "old", "oldsymbol", "ot", "owtie",
    "ox", "oxdot", "oxed", "oxminus", "oxplus", "oxtimes",
    "reve", "ullet", "umpeq",
)

_UNAMBIGUOUS_F_SUFFIXES = (
    "allingdotseq", "box", "lat", "orall", "rac", "rown",
)

_UNAMBIGUOUS_N_SUFFIXES = (
    "abla", "atural", "earrow", "eg", "eq", "ewcommand",
    "gtr", "Leftarrow", "leftarrow", "Leftrightarrow", "leftrightarrow",
    "leq", "leqq", "leqslant", "mid", "oindent", "olimits", "onumber",
    "orm", "ot", "otin", "prec", "preceq", "Rightarrow", "rightarrow",
    "shortmid", "shortparallel", "sim", "subseteq", "subseteqq",
    "succ", "succeq", "supseteq", "supseteqq",
    "triangleleft", "trianglelefteq", "triangleright", "trianglerighteq",
    "VDash", "Vdash", "vDash", "vdash", "warrow",
)

_UNAMBIGUOUS_R_SUFFIXES = (
    "aisebox", "angle", "brace", "brack", "ceil", "e", "eal", "estriction",
    "floor", "group", "hd", "ho",
    "ight", "ightarrow", "ightarrowtail", "ightharpoondown", "ightharpoonup",
    "ightleftarrows", "ightleftharpoons", "ightrightarrows", "ightsquigarrow",
    "ightthreetimes", "isingdotseq", "m", "moustache", "times", "ule",
    "Vert", "vert",
)

_UNAMBIGUOUS_T_SUFFIXES = (
    "anh", "au", "binom", "eX",
    "ext", "extbf", "extit", "extmd", "extnormal", "extrm",
    "extsc", "extsf", "extsl", "exttt", "extup",
    "frac", "herefore", "heta", "hickapprox", "hicksim", "hinspace",
    "ilde", "imes", "iny",
    "riangle", "riangledown", "riangleleft", "rianglelefteq",
    "riangleq", "riangleright", "rianglerighteq",
    "woheadleftarrow", "woheadrightarrow",
)

_UNAMBIGUOUS_LATEX_BFNRT_COMMANDS = frozenset(
    [f"b{s}" for s in _UNAMBIGUOUS_B_SUFFIXES]
    + [f"f{s}" for s in _UNAMBIGUOUS_F_SUFFIXES]
    + [f"n{s}" for s in _UNAMBIGUOUS_N_SUFFIXES]
    + [f"r{s}" for s in _UNAMBIGUOUS_R_SUFFIXES]
    + [f"t{s}" for s in _UNAMBIGUOUS_T_SUFFIXES]
)

# Tier 2: Short or potentially ambiguous commands (e.g., \nu vs \n + u, \to vs \t + o,
# \nexists vs \n + exists) that are treated as LaTeX commands ONLY inside math delimiters.
_MATH_ONLY_N_SUFFIXES = ("e", "exists", "i", "less", "parallel", "u")
_MATH_ONLY_T_SUFFIXES = ("ag", "an", "o", "op")

_MATH_ONLY_LATEX_BFNRT_COMMANDS = frozenset(
    [f"n{s}" for s in _MATH_ONLY_N_SUFFIXES]
    + [f"t{s}" for s in _MATH_ONLY_T_SUFFIXES]
)

# Compiled post-decode control-character recovery regexes (Tier 1: safe anywhere)
_CTRL_B_RE = re.compile("\x08(" + "|".join(sorted(_UNAMBIGUOUS_B_SUFFIXES, key=len, reverse=True)) + r")(?![a-zA-Z])")
_CTRL_F_RE = re.compile("\x0c(" + "|".join(sorted(_UNAMBIGUOUS_F_SUFFIXES, key=len, reverse=True)) + r")(?![a-zA-Z])")
_CTRL_N_RE = re.compile("\x0a(" + "|".join(sorted(_UNAMBIGUOUS_N_SUFFIXES, key=len, reverse=True)) + r")(?![a-zA-Z])")
_CTRL_R_RE = re.compile("\x0d(" + "|".join(sorted(_UNAMBIGUOUS_R_SUFFIXES, key=len, reverse=True)) + r")(?![a-zA-Z])")
_CTRL_T_RE = re.compile("\x09(" + "|".join(sorted(_UNAMBIGUOUS_T_SUFFIXES, key=len, reverse=True)) + r")(?![a-zA-Z])")

# Compiled post-decode control-character recovery regexes (Tier 2: inside math spans only)
_MATH_CTRL_N_RE = re.compile("\x0a(" + "|".join(sorted(_MATH_ONLY_N_SUFFIXES, key=len, reverse=True)) + r")(?![a-zA-Z])")
_MATH_CTRL_T_RE = re.compile("\x09(" + "|".join(sorted(_MATH_ONLY_T_SUFFIXES, key=len, reverse=True)) + r")(?![a-zA-Z])")

# Brace-taking LaTeX macros that may lose their leading backslash in constrained JSON mode
_BARE_BRACE_MACROS = (
    "text", "textbf", "textit", "textrm", "texttt", "textsf", "textnormal",
    "textup", "textmd", "textsc", "textsl",
    "frac", "dfrac", "tfrac", "sqrt",
    "mathcal", "mathbb", "mathbf", "mathrm", "mathit", "mathsf", "mathtt",
    "hat", "widehat", "bar", "overline", "underline", "vec", "tilde", "widetilde",
    "dot", "ddot", "binom", "boxed", "operatorname",
)
_BARE_BRACE_MACRO_RE = re.compile(
    r"(?<![\\a-zA-Z])(" + "|".join(sorted(_BARE_BRACE_MACROS, key=len, reverse=True)) + r")(?=\s*\{)"
)

# Protected text-mode / roman-word macros whose inner { ... } content should NOT undergo bare Greek replacement
_PROTECTED_TEXT_MACRO_RE = re.compile(
    r"(\\(?:text|textbf|textit|textrm|texttt|textsf|textnormal|textup|textmd|textsc|textsl|mathrm|mathit|mathsf|mathtt|operatorname)\s*\{[^{}]*\})"
)

# Standalone Greek letters and unambiguous LaTeX math symbols that lose their backslash in constrained JSON mode
_BARE_MATH_SYMBOLS = (
    # Lowercase Greek
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
    "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi",
    "pi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon",
    "phi", "varphi", "chi", "psi", "omega",
    # Uppercase Greek (non-ASCII-identical)
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
    # Unambiguous multi-letter math operators / symbols
    "nabla", "partial", "infty", "approx", "equiv", "propto", "simeq",
    "cdot", "cdots", "ldots", "times", "leq", "geq", "neq",
    "subseteq", "supseteq", "forall", "exists", "implies", "iff",
    "rightarrow", "leftarrow", "Rightarrow", "Leftarrow",
)
_BARE_MATH_SYMBOL_RE = re.compile(
    r"(?<![\\a-zA-Z])(" + "|".join(sorted(_BARE_MATH_SYMBOLS, key=len, reverse=True)) + r")(?![a-zA-Z])"
)

# Unified single-pass math span matcher:
# 1. $$ ... $$ display math
# 2. $ ... $ inline math (allowing \x0a only when followed by a Tier-2 math suffix like \x0au -> \nu;
#    closing $ must not be followed by a digit so "$100 and $200" currency pairs are not misread as math)
# 3. \[ ... \] display math
# 4. \( ... \) inline math
_UNIFIED_MATH_SPAN_RE = re.compile(
    r"(\$\$([\s\S]+?)\$\$"
    r"|(?<!\\|\$)\$(?!\$)((?:\\.|(?:\x0a(?:e|exists|i|less|parallel|u)(?![a-zA-Z]))|[^\n$])+?)(?<!\\)\$(?!\$|\d)"
    r"|\\\[([\s\S]+?)\\\]"
    r"|\\\(([\s\S]+?)\\\))"
)


def _has_closing_dollar_in_json_string(s: str, start_idx: int) -> bool:
    """Return True if an unescaped '$' appears before the closing unescaped '"' of the current JSON string."""
    i = start_idx
    n = len(s)
    while i < n:
        c = s[i]
        if c == "\\":
            i += 2
            continue
        if c == '"':
            return False
        if c == "$":
            return True
        i += 1
    return False


def repair_json_latex_escapes(raw_json: str) -> str:
    """
    Repair unescaped LaTeX backslashes inside JSON string literals BEFORE calling json.loads().
    Preserves valid JSON escapes (\\", \\\\, \\/, \\uXXXX, and genuine \\n / \\t / \\r whitespace)
    while doubling backslashes that belong to LaTeX commands (including \\theta, \\times, \\text,
    \\frac, \\beta, \\nabla, \\rho, \\alpha, \\eta, etc.).
    """
    if not raw_json:
        return raw_json

    out = []
    in_string = False
    in_math = False
    math_is_display = False
    i = 0
    n = len(raw_json)

    while i < n:
        c = raw_json[i]
        if not in_string:
            if c == '"':
                in_string = True
                in_math = False
                math_is_display = False
            out.append(c)
            i += 1
            continue

        # Inside a JSON string literal
        if c == '"':
            in_string = False
            in_math = False
            math_is_display = False
            out.append(c)
            i += 1
        elif c == "$":
            if i + 1 < n and raw_json[i + 1] == "$":
                if not in_math:
                    if _has_closing_dollar_in_json_string(raw_json, i + 2):
                        in_math = True
                        math_is_display = True
                elif math_is_display:
                    in_math = False
                    math_is_display = False
                out.append("$$")
                i += 2
            else:
                if not in_math:
                    if _has_closing_dollar_in_json_string(raw_json, i + 1):
                        in_math = True
                        math_is_display = False
                elif not math_is_display:
                    in_math = False
                out.append("$")
                i += 1
        elif c == "\\":
            if i + 1 >= n:
                out.append("\\\\")
                i += 1
                continue

            nxt = raw_json[i + 1]
            if nxt == "\\":
                # Already double-escaped backslash in JSON. Track \( \[ \) \] math state if applicable.
                after = raw_json[i + 2] if i + 2 < n else ""
                if after in ("(", "["):
                    in_math = True
                    math_is_display = (after == "[")
                elif after in (")", "]"):
                    in_math = False
                    math_is_display = False
                out.append("\\\\")
                i += 2
            elif nxt in ('"', "/"):
                out.append("\\" + nxt)
                i += 2
            elif (
                nxt == "u"
                and i + 5 < n
                and all(ch in "0123456789abcdefABCDEF" for ch in raw_json[i + 2 : i + 6])
            ):
                out.append(raw_json[i : i + 6])
                i += 6
            elif nxt in ("b", "f", "n", "r", "t"):
                m = _ASCII_WORD_RE.match(raw_json, i + 1)
                cmd = m.group(0) if m else nxt
                if cmd in _UNAMBIGUOUS_LATEX_BFNRT_COMMANDS or (
                    in_math and cmd in _MATH_ONLY_LATEX_BFNRT_COMMANDS
                ):
                    out.append("\\\\" + nxt)
                else:
                    out.append("\\" + nxt)
                i += 2
            else:
                # Non-JSON escape (e.g. \alpha, \eta, \sigma, \(, \[, \{, \|)
                if nxt in ("(", "["):
                    in_math = True
                    math_is_display = (nxt == "[")
                elif nxt in (")", "]"):
                    in_math = False
                    math_is_display = False
                out.append("\\\\" + nxt)
                i += 2
        else:
            out.append(c)
            i += 1

    return "".join(out)


def _repair_math_inner(math_body: str) -> str:
    """Repair Tier-2 control-char corruptions and bare LaTeX commands/symbols inside a single math span."""
    if not math_body:
        return math_body

    # 1. Recover Tier-2 control-char-mangled LaTeX commands (\to, \top, \tan, \tag, \nu, \ne, \ni, ...)
    fixed = _MATH_CTRL_T_RE.sub(lambda m: "\\t" + m.group(1), math_body)
    fixed = _MATH_CTRL_N_RE.sub(lambda m: "\\n" + m.group(1), fixed)

    # 2. Recover bare brace-taking macros outside existing protected text macros
    # First split by already-escaped protected text macros so we don't touch text inside \text{...}
    parts = _PROTECTED_TEXT_MACRO_RE.split(fixed)
    rebuilt = []
    for idx, part in enumerate(parts):
        if idx % 2 == 1:
            # Already an escaped \text{...} / \mathrm{...} / \operatorname{...} block
            rebuilt.append(part)
        else:
            rebuilt.append(_BARE_BRACE_MACRO_RE.sub(lambda m: "\\" + m.group(1), part))
    fixed = "".join(rebuilt)

    # 3. Re-split after restoring \text{...} so newly restored \text{gradient} is ALSO protected!
    parts = _PROTECTED_TEXT_MACRO_RE.split(fixed)
    final_parts = []
    for idx, part in enumerate(parts):
        if idx % 2 == 1:
            final_parts.append(part)
        else:
            final_parts.append(_BARE_MATH_SYMBOL_RE.sub(lambda m: "\\" + m.group(1), part))

    return "".join(final_parts)


def repair_corrupted_latex_text(text: str) -> str:
    """
    Heal LaTeX math formulas in an already-decoded string:
    1. Restores control characters (\\x08, \\x0c, \\x0a, \\x0d, \\x09) that resulted from
       unescaped \\beta, \\frac, \\nabla, \\rho, \\theta, \\times, \\text, etc.
    2. Inside math spans ($...$, $$...$$, \\(...\\), \\[...\\]), restores Tier-2 commands
       (\\to, \\nu, \\ne, etc.) and missing backslashes on Greek letters / operators / brace macros
       (such as "eta" -> "\\eta" and "text{gradient}" -> "\\text{gradient}").
    """
    if not text or not isinstance(text, str):
        return text

    # Step 1: Restore unambiguous control-character-mangled LaTeX commands anywhere in text
    repaired = _CTRL_B_RE.sub(lambda m: "\\b" + m.group(1), text)
    repaired = _CTRL_F_RE.sub(lambda m: "\\f" + m.group(1), repaired)
    repaired = _CTRL_N_RE.sub(lambda m: "\\n" + m.group(1), repaired)
    repaired = _CTRL_R_RE.sub(lambda m: "\\r" + m.group(1), repaired)
    repaired = _CTRL_T_RE.sub(lambda m: "\\t" + m.group(1), repaired)

    # Step 2: Inside math delimiters, restore Tier-2 commands and bare Greek / math symbols
    if "$" in repaired or "\\(" in repaired or "\\[" in repaired:
        def _replace_span(match: re.Match) -> str:
            if match.group(2) is not None:
                return f"$${_repair_math_inner(match.group(2))}$$"
            if match.group(3) is not None:
                inner = _repair_math_inner(match.group(3)).lstrip()
                inner = re.sub(r"(?<!\\)[ \t]+$", "", inner)
                return f"${inner}$"
            if match.group(4) is not None:
                return f"\\[{_repair_math_inner(match.group(4))}\\]"
            if match.group(5) is not None:
                return f"\\({_repair_math_inner(match.group(5))}\\)"
            return match.group(0)

        repaired = _UNIFIED_MATH_SPAN_RE.sub(_replace_span, repaired)

    return repaired


def safe_json_loads_with_latex(raw_text: str) -> Any:
    """
    Strip markdown code fences, repair unescaped LaTeX backslashes BEFORE json.loads,
    and parse JSON resiliently.
    """
    if not raw_text:
        raise ValueError("Empty JSON input")

    t = raw_text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t).strip()

    repaired = repair_json_latex_escapes(t)
    try:
        return json.loads(repaired, strict=False)
    except Exception:
        pass

    # Fallback: try raw directly in case input had unusual quoting
    try:
        return json.loads(t, strict=False)
    except Exception:
        pass

    # Fallback: extract outermost JSON object or array from repaired text
    obj_match = re.search(r"\{[\s\S]*\}", repaired)
    arr_match = re.search(r"\[[\s\S]*\]", repaired)
    candidate = None
    if obj_match and arr_match:
        candidate = obj_match.group(0) if obj_match.start() <= arr_match.start() else arr_match.group(0)
    elif obj_match:
        candidate = obj_match.group(0)
    elif arr_match:
        candidate = arr_match.group(0)

    if candidate:
        return json.loads(candidate, strict=False)

    # Final fallback: aggressive non-JSON escape doubling
    fallback = re.sub(r'\\(?![/"\\bfnrt]|u[0-9a-fA-F]{4})', r"\\\\", repaired)
    return json.loads(fallback, strict=False)


def repair_latex_in_structure(obj: Any) -> Any:
    """Recursively apply repair_corrupted_latex_text to all strings in a dict/list structure."""
    if isinstance(obj, str):
        return repair_corrupted_latex_text(obj)
    if isinstance(obj, list):
        return [repair_latex_in_structure(item) for item in obj]
    if isinstance(obj, dict):
        return {k: repair_latex_in_structure(v) for k, v in obj.items()}
    return obj
