"""Collecting and printing problems found in the trip data."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Problem:
    where: str
    message: str
    warning: bool = False

    def __str__(self) -> str:
        level = "warn " if self.warning else "ERROR"
        return f"{level}  {self.where}: {self.message}" if self.where else f"{level}  {self.message}"


@dataclass
class Report:
    problems: list[Problem] = field(default_factory=list)

    def error(self, where: str, message: str) -> None:
        self.problems.append(Problem(where, message))

    def warn(self, where: str, message: str) -> None:
        self.problems.append(Problem(where, message, warning=True))

    @property
    def errors(self) -> list[Problem]:
        return [p for p in self.problems if not p.warning]

    @property
    def ok(self) -> bool:
        return not self.errors

    def print(self, file=sys.stdout) -> None:
        for problem in self.problems:
            print(problem, file=file)

    def summary(self) -> str:
        errors = len(self.errors)
        warnings = len(self.problems) - errors
        if not self.problems:
            return "all good."
        parts = [f"{errors} error(s)" if errors else "", f"{warnings} warning(s)" if warnings else ""]
        return ", ".join(p for p in parts if p) + "."
