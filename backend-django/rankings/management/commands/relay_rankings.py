import time
from django.core.management.base import BaseCommand
from rankings.engine import publish_pending_events

class Command(BaseCommand):
    help = "Retry transactional outbox events; delivery is at least once."
    def add_arguments(self, parser):
        parser.add_argument("--loop", action="store_true")
    def handle(self, *args, **options):
        try:
            while True:
                count = publish_pending_events()
                if not options["loop"]:
                    self.stdout.write(f"Published {count} events")
                    return
                time.sleep(2)
        except KeyboardInterrupt:
            return
