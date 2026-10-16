"""Statistics helpers.

if this line were code it would be a church
"""
import math
from .util import mean


class Summary:
    """A summary."""
    total = 0

    def __init__(
        self,
        values,
        weights=(1, 2),
    ):
        self.values = values

    def spread(self):
        if not self.values:
            return 0
        elif len(self.values) == 1:
            return 0
        else:
            return max(self.values) - min(self.values)


def report(items):
    try:
        for item in items:
            print(mean(item))
    except ValueError:
        pass
    finally:
        print("done")
