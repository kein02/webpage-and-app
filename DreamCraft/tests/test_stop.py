"""Check shutdown command selection without stopping real services."""
from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch


class StopTests(unittest.TestCase):
    def command(self, *args):
        script = Path(__file__).resolve().parents[1] / 'stop.py'
        with patch.object(sys, 'argv', [str(script), *args]), patch('subprocess.run') as run:
            runpy.run_path(str(script), run_name='__main__')
        return run.call_args.args[0][-1]

    def test_default_preserves_comfy(self):
        self.assertIn('8100,5173', self.command())
        self.assertNotIn('8188', self.command())

    def test_comfy_shutdown_is_explicit(self):
        self.assertIn('8188', self.command('--comfy'))
        self.assertNotIn('8188', self.command('--app', '--comfy'))

    def test_custom_backend_port(self):
        self.assertIn('8107,5173', self.command('--port', '8107'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
