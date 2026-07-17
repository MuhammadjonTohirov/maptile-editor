import sys
from pathlib import Path

# The backend is a flat module layout rooted at /app in the container; make
# the same imports work when pytest runs from the repository root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
