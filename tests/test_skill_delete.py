import tempfile
import unittest
from pathlib import Path

from app.core.skills.manager import SkillManager


SKILL_MD = """---
name: demo-skill
description: Demo skill
---

# Demo
"""


class SkillDeleteTest(unittest.TestCase):
    def test_deletes_custom_skill_directory_and_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            builtin_dir = root / "builtin"
            custom_dir = root / "skills"
            skill_dir = custom_dir / "demo"
            builtin_dir.mkdir()
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
            manager = SkillManager(builtin_dir=str(builtin_dir), custom_dir=str(custom_dir))
            manager.update_skill_config("demo-skill", {"enabled": False, "source": "clawhub"})

            deleted_path = manager.delete_skill("demo-skill")

            self.assertEqual(Path(deleted_path), skill_dir.resolve())
            self.assertFalse(skill_dir.exists())
            self.assertNotIn("demo-skill", manager.get_skills_config())
            self.assertIsNone(manager.get_skill("demo-skill"))

    def test_deletes_root_markdown_file_without_deleting_skills_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            builtin_dir = root / "builtin"
            custom_dir = root / "skills"
            builtin_dir.mkdir()
            custom_dir.mkdir()
            skill_file = custom_dir / "demo.md"
            skill_file.write_text(SKILL_MD, encoding="utf-8")
            manager = SkillManager(builtin_dir=str(builtin_dir), custom_dir=str(custom_dir))

            deleted_path = manager.delete_skill("demo-skill")

            self.assertEqual(Path(deleted_path), skill_file.resolve())
            self.assertFalse(skill_file.exists())
            self.assertTrue(custom_dir.exists())

    def test_refuses_builtin_skill_delete(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            builtin_dir = root / "builtin"
            custom_dir = root / "skills"
            skill_dir = builtin_dir / "demo"
            skill_dir.mkdir(parents=True)
            custom_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(SKILL_MD, encoding="utf-8")
            manager = SkillManager(builtin_dir=str(builtin_dir), custom_dir=str(custom_dir))

            with self.assertRaises(PermissionError):
                manager.delete_skill("demo-skill")

            self.assertTrue((skill_dir / "SKILL.md").exists())


if __name__ == "__main__":
    unittest.main()
