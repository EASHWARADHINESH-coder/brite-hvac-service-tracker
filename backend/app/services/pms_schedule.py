"""Auto-generate PMS visit dates from a WO start date + frequency.

Frequency is expressed as "N PMS/Year" (visits per year); the gap between visits
is 12 / N months (e.g. 4/year -> every 3 months, 6/year -> every 2 months).
Legacy "N Months Once/Year" labels are still understood (N = month interval).

Visit dates are always the 1st of the month: the first visit is the 1st of the WO
start month, then we step forward by the interval. Generation stops at the WO end
date (if set), else after one year's worth of visits.
"""

import re
from datetime import date


def _add_months(d: date, months: int) -> date:
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


def parse_interval_months(schedule: str | None) -> int | None:
    """Month gap between visits. 'N PMS/Year' -> 12//N; legacy 'N Months' -> N."""
    if not schedule:
        return None
    m = re.search(r"(\d+)\s*PMS", schedule, flags=re.IGNORECASE)
    if m:
        count = int(m.group(1))
        return max(1, 12 // count) if count else None
    m = re.search(r"(\d+)\s*month", schedule, flags=re.IGNORECASE)
    return int(m.group(1)) if m else None


def _visits_per_year(interval: int) -> int:
    return max(1, 12 // interval)


def generate_visit_dates(
    wo_start: date | None,
    schedule: str | None,
    wo_end: date | None = None,
    max_visits: int = 60,
) -> list[date]:
    """Visit dates (1st of month) stepping by the interval from the WO start month.

    With a WO end date, visits run until (and including) that date; otherwise one
    year's worth (visits-per-year) are produced. Returns [] on insufficient input.
    """
    interval = parse_interval_months(schedule)
    if wo_start is None or not interval:
        return []

    first = date(wo_start.year, wo_start.month, 1)
    year_count = _visits_per_year(interval)

    visits: list[date] = []
    current = first
    for i in range(max_visits):
        if wo_end is not None:
            if current > wo_end:
                break
        elif i >= year_count:
            break
        visits.append(current)
        current = _add_months(current, interval)
    return visits
