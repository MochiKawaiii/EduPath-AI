"""Unit tests for Paddle device selection and the text-first OCR route."""
from collections import Counter
import builtins
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from ppocr_table import resolve_device


def fake_paddle(compiled=True, count=1, count_error=None):
    device_count = Mock(return_value=count)
    if count_error is not None:
        device_count.side_effect = count_error
    return SimpleNamespace(
        is_compiled_with_cuda=Mock(return_value=compiled),
        device=SimpleNamespace(cuda=SimpleNamespace(device_count=device_count)),
    )


class ResolveDeviceTests(TestCase):
    def test_auto_selects_gpu_when_cuda_and_device_are_available(self):
        paddle = fake_paddle(compiled=True, count=1)
        with patch.dict(sys.modules, {"paddle": paddle}):
            self.assertEqual(resolve_device("auto"), "gpu:0")
        paddle.is_compiled_with_cuda.assert_called_once_with()
        paddle.device.cuda.device_count.assert_called_once_with()

    def test_auto_uses_cpu_when_cuda_is_not_compiled_or_device_is_missing(self):
        for paddle in (fake_paddle(compiled=False, count=1), fake_paddle(compiled=True, count=0)):
            with self.subTest(paddle=paddle), patch.dict(sys.modules, {"paddle": paddle}):
                self.assertEqual(resolve_device("auto"), "cpu")

    def test_auto_falls_back_to_cpu_when_cuda_probe_raises(self):
        paddle = fake_paddle(compiled=True, count_error=OSError("driver unavailable"))
        with patch.dict(sys.modules, {"paddle": paddle}):
            self.assertEqual(resolve_device("auto"), "cpu")

    def test_explicit_devices_return_without_importing_paddle(self):
        original_import = builtins.__import__

        def reject_paddle(name, *args, **kwargs):
            if name == "paddle":
                raise AssertionError("explicit device selection imported paddle")
            return original_import(name, *args, **kwargs)

        with patch("builtins.__import__", side_effect=reject_paddle):
            self.assertEqual(resolve_device("cpu"), "cpu")
            self.assertEqual(resolve_device("gpu:0"), "gpu:0")


class NativeRouteTests(TestCase):
    def test_usable_native_text_does_not_initialize_ocr(self):
        import test_ocr

        class Page:
            number = 0

            @staticmethod
            def get_image_info():
                return []

        class Document:
            is_pdf = True

            def __iter__(self):
                return iter([Page()])

        models = {}
        with patch.object(test_ocr, "native_rows", return_value=([], True, Counter())):
            with patch.object(
                test_ocr, "_ppocr_page", side_effect=AssertionError("OCR should remain lazy")
            ) as ocr_page:
                result = test_ocr.extract_transcript(
                    Document(),
                    "synthetic.pdf",
                    test_ocr.Options(mode="auto", device="auto"),
                    models=models,
                    log=lambda _message: None,
                )

        self.assertEqual([page["method"] for page in result["pages"]], ["pdf_text"])
        ocr_page.assert_not_called()
        self.assertEqual(models, {})


if __name__ == "__main__":
    import unittest

    unittest.main()
