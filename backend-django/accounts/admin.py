from django.contrib import admin
from .models import AuditEntry

@admin.register(AuditEntry)
class AuditAdmin(admin.ModelAdmin):
    list_display = ["created_at", "actor", "action", "target_type", "target_id"]
    readonly_fields = [f.name for f in AuditEntry._meta.fields]
    def has_add_permission(self, request): return False
    def has_change_permission(self, request, obj=None): return False
    def has_delete_permission(self, request, obj=None): return False
