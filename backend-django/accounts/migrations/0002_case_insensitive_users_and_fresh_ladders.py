from django.db import migrations


def fresh_ladders(apps, schema_editor):
    State = apps.get_model("rankings", "RankingState")
    for pk in (1, 2):
        state, _ = State.objects.get_or_create(pk=pk)
        state.revision += 1
        state.save(update_fields=["revision"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0001_initial"), ("rankings", "0002_player_is_active_player_registered_at_player_user"), ("teams", "0003_remove_teamregistration_contact_email_team_is_active_and_more")]
    operations = [migrations.RunSQL("CREATE UNIQUE INDEX IF NOT EXISTS dawest_auth_username_ci ON auth_user (LOWER(username));", "DROP INDEX IF EXISTS dawest_auth_username_ci;"), migrations.RunPython(fresh_ladders, migrations.RunPython.noop)]
