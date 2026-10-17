import unittest
from fastapi import HTTPException
from workflow_studio import builtin, check_capability

class AdoptionPolicyTests(unittest.TestCase):
    def test_information_shortcuts_do_not_create_artifacts(self):
        for stage in ('F'+str(n) for n in range(1,14) if n!=5):
            tasks=builtin(stage)['tasks']
            survey=next(t for t in tasks if t['id']=='materials-survey')
            self.assertFalse({'review','export'} & {s['capability'] for s in survey['steps']})
            self.assertTrue(any(s['capability']=='review' for t in tasks if t['id']!='materials-survey' for s in t['steps']))
    def test_existing_survey_versions_cannot_be_adopted(self):
        with self.assertRaises(HTTPException):
            check_capability(None,'old-config','materials-survey','review')
