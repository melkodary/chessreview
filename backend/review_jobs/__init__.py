"""Async review job queue (phase 1: in-memory).

`review_jobs/` (this package) manages review *jobs* — the durable queue and its
results. It sits beside `review/`, which is the engine layer ("how to analyze a
game"). Keep the distinction sharp: `review/` = analysis, `review_jobs/` = job
lifecycle.
"""
