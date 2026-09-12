"""
A pause on repeated failed sign-ins.

The sign-in form is on the public internet and a password is the only thing
in front of an account, so an unlimited number of guesses per second is the
whole attack. Counted per address *and* per account: per address alone lets a
botnet spread the guessing out, per account alone lets one impatient person
lock a colleague out of their own account — so a failure marks both, and a
success clears the account's own count immediately.

Held in this process's memory, which is exactly as far as it needs to go
while the app runs a single worker. When that changes (Redis), this moves
with it; until then a restart forgetting a few counts is a far smaller
problem than not counting at all.
"""
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional, Tuple

# Five wrong passwords in five minutes is a person who has forgotten theirs;
# more is something else. The wait doubles nothing and forgives everything
# older than the window, so a real person is never locked out for long.
MAX_FAILURES = 5
WINDOW_SECONDS = 5 * 60


class LoginThrottle:
    def __init__(self, max_failures: int = MAX_FAILURES, window_seconds: int = WINDOW_SECONDS):
        self.max_failures = max_failures
        self.window_seconds = window_seconds
        self._failures: Dict[str, Deque[float]] = defaultdict(deque)

    def _prune(self, key: str, now: float) -> Deque[float]:
        attempts = self._failures[key]
        while attempts and now - attempts[0] > self.window_seconds:
            attempts.popleft()
        if not attempts:
            self._failures.pop(key, None)
        return attempts

    def retry_after(self, *keys: str) -> Optional[int]:
        """Seconds to wait before another attempt is accepted, or None."""
        now = time.time()
        worst = None
        for key in keys:
            if not key:
                continue
            attempts = self._prune(key, now)
            if len(attempts) >= self.max_failures:
                wait = int(self.window_seconds - (now - attempts[0])) + 1
                worst = max(worst or 0, wait)
        return worst

    def record_failure(self, *keys: str) -> None:
        now = time.time()
        for key in keys:
            if key:
                self._failures[key].append(now)

    def clear(self, *keys: str) -> None:
        for key in keys:
            self._failures.pop(key, None)


login_throttle = LoginThrottle()


def client_address(request) -> Optional[str]:
    """
    Who is actually calling, as far as that can be known.

    Not `request.client.host`: this app is reached through a tunnel and then
    nginx, so that is always the proxy's own address — counting against it
    would put every person in the world in one bucket, and five wrong
    passwords would lock out the whole company. Cloudflare overwrites
    `CF-Connecting-IP` on the way in, so it is the one field here that a
    caller cannot choose for itself. `X-Forwarded-For` is not used: Cloudflare
    appends to whatever the caller already put there, so its first entry is
    the caller's to invent.

    None when there is no trustworthy answer, and then nothing is counted
    against an address at all — an account's own count still applies, which is
    what stops a password being guessed.
    """
    value = request.headers.get("cf-connecting-ip")
    if value:
        value = value.strip()
    return value or None


def login_keys(email: str, client_ip: Optional[str]) -> Tuple[str, ...]:
    """What a failed sign-in is counted against. The account always; the
    address as well when one can be trusted."""
    keys = [f"account:{(email or '').strip().lower()}"]
    if client_ip:
        keys.append(f"address:{client_ip}")
    return tuple(keys)
