import sys
from pkg.stats import report
from pkg import util

LEVEL = 3


def main(argv):
    match argv[0]:
        case "report":
            report(argv[1:])
        case "mean":
            print(util.mean([1, 2]))
        case _:
            pass


if __name__ == "__main__":
    main(sys.argv[1:])
