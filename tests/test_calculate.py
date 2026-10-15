import unittest
from project_hub.calculate import calculate
from project_hub.projects import ProjectError


class CalculationTests(unittest.TestCase):
    def test_boundary_counts_and_ordered_percentages(self):
        self.assertEqual(calculate('12*25 + (12-1)*5')['value'], '355')
        self.assertEqual(calculate('80*(1-0.25)*(1+0.20)')['value'], '72.0000')
        self.assertEqual(calculate('0.1 + 0.2')['value'], '0.3')
        self.assertTrue(calculate('1/3')['rounded'])
        self.assertFalse(calculate('1/4')['rounded'])

    def test_code_names_and_unbounded_expressions_are_not_executed(self):
        for expression in ('__import__("os")', 'open("file")', 'True+1', '[1][0]', '1/0', '10**10000', '1e200', '2**0.5', '1+' * 100 + '1'):
            with self.subTest(expression=expression), self.assertRaises(ProjectError): calculate(expression)
