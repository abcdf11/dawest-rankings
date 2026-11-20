from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_case_insensitive_users_and_fresh_ladders"), ("auth", "0012_alter_user_first_name_max_length")]
    operations = [migrations.RunSQL("CREATE UNIQUE INDEX IF NOT EXISTS dawest_auth_username_ci ON auth_user (LOWER(username));", "DROP INDEX IF EXISTS dawest_auth_username_ci;")]
