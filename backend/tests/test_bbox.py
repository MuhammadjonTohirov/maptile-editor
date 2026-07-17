import pytest
from fastapi import HTTPException

from features_api import _bbox_filter


def test_bbox_filter_accepts_valid_viewport():
    # Returns a SQL expression without raising; execution is covered end to end.
    assert _bbox_filter("69.2,41.29,69.22,41.31") is not None


def test_bbox_filter_rejects_wrong_arity():
    with pytest.raises(HTTPException) as excinfo:
        _bbox_filter("1,2,3")
    assert excinfo.value.status_code == 422


def test_bbox_filter_rejects_non_numeric():
    with pytest.raises(HTTPException):
        _bbox_filter("a,b,c,d")


def test_bbox_filter_rejects_inverted_axes():
    with pytest.raises(HTTPException):
        _bbox_filter("70,41,69,42")
