# Milestone 2+ business logic (catalogue service, try-on request service, etc.) lives
# here. Services call into ai/engines through the TryOnEngine interface; they never
# import a concrete AI model or the queue library directly.
