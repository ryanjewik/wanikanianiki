"""A sense label is whatever the model listed, and some run long.

Choosing one used to fail validation past 64 characters, which the phone
reported as an unreachable backend.
"""

from app.schemas import GrammarEntryUpdate

LONG = "speaking of / bringing up a topic that someone has just mentioned in passing"


def test_a_long_sense_label_is_accepted():
    assert len(LONG) > 64
    assert GrammarEntryUpdate(sense_label=LONG).sense_label == LONG
