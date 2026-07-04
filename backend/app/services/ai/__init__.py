"""AI layer (Phase 5).

Every feature here is *fallback-first*: a deterministic implementation always produces
a result, and the LLM (Groq) is only invoked to enhance it when configured
(`settings.ai_ready`). If Groq is unavailable, the packages aren't installed, or a call
errors/times out, the deterministic output is returned unchanged. This keeps the whole
app working in environments without an API key and makes the AI strictly additive.
"""
