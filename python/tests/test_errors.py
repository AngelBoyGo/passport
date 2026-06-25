import unittest

from passport_sdk.errors import map_error_to_tranche


class MapErrorToTrancheTests(unittest.TestCase):
    def test_timeout_maps_to_compute_timeout(self):
        self.assertEqual(
            map_error_to_tranche(TimeoutError("request timed out")),
            "COMPUTE_TIMEOUT",
        )

    def test_connection_error_maps_to_compute_timeout(self):
        self.assertEqual(
            map_error_to_tranche(ConnectionError("connection refused")),
            "COMPUTE_TIMEOUT",
        )

    def test_validation_maps_to_logic_detection(self):
        self.assertEqual(
            map_error_to_tranche(ValueError("validation failed for schema")),
            "LOGIC_DETECTION",
        )

    def test_type_error_maps_to_logic_detection(self):
        self.assertEqual(
            map_error_to_tranche(TypeError("unexpected type")),
            "LOGIC_DETECTION",
        )

    def test_default_maps_to_sla_breach(self):
        self.assertEqual(
            map_error_to_tranche(RuntimeError("unexpected")),
            "SLA_BREACH",
        )


if __name__ == "__main__":
    unittest.main()
