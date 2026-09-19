"""
Compatibility alias: `services.queue_service` IS `services.queue_services`.

The module on disk is queue_services.py (plural) but routes/staff_queue.py, routes/tokens.py and
services/scheduler.py import `services.queue_service`. Rather than editing every importer, this
makes both names resolve to the same module object, so there is a single copy of the logic (and
monkeypatching either name affects both). Delete this file once the imports are unified.
"""
import sys

from services import queue_services as _impl

sys.modules[__name__] = _impl
