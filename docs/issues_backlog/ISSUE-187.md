# infra/secrets_rotation.py: Secret rotation Lambda overwrites JSON credentials with raw hex string, breaking database connection

**Domain:** Infra & Security  
**Complexity:** Hard  
**Labels:** `bug`, `security`, `infra`, `critical-bug`  
**Issue ID:** ISSUE-187

---

## Background
In `infra/secrets_rotation.py` (lines 48-59):
```python
def create_secret(secret_id: str, token: str) -> None:
    ...
    # Generate new 32-byte hex secret (matches initial secret format)
    import secrets
    new_secret = secrets.token_hex(32)
    
    # Save the new secret as AWSPENDING
    secrets_manager.put_secret_value(
        SecretId=secret_id,
        ClientRequestToken=token,
        SecretString=new_secret,
        VersionStages=['AWSPENDING']
    )
```
When rotating database secrets, the Lambda generates a 32-byte hex string and stores it as the entire secret string.

## Problem
- The application (`backend/src/config/secrets.js` and Prisma) expects the database secret in AWS Secrets Manager to be a structured JSON object:
  `{"engine":"postgres","host":"...","username":"future_admin","password":"...","dbname":"future_remittance","port":5432}`.
- When `secrets_rotation.py` runs, it overwrites `SecretString` with `a3f89...` (plain hex).
- When the backend application reboots or reads the rotated secret:
  `JSON.parse(secretString)` throws a `SyntaxError: Unexpected token 'a'`!
- The backend crashes completely, taking down all API services and causing total database outage!

## Proposed Solution
1. Fetch the existing `AWSCURRENT` secret value and parse it as JSON:
```python
current_dict = json.loads(current_secret_string)
current_dict['password'] = new_password
```
2. Preserve `engine`, `host`, `username`, `dbname`, and `port`.
3. Format the updated dictionary back to JSON before calling `put_secret_value` with `AWSPENDING`.
4. Update the RDS master user password via `rds.modify_db_instance` during `set-secret` before staging is marked complete.

## Implementation Steps
1. Refactor `create_secret` in `infra/secrets_rotation.py` to preserve existing JSON dictionary fields.
2. Update `set_secret` to call `rds_client.modify_db_instance` to apply the new password to PostgreSQL.
3. Add automated test verifying JSON structure preservation during secret rotation.

## Acceptance Criteria
- [ ] Rotated secret retains valid JSON format with updated password.
- [ ] Backend services can parse rotated secret without syntax errors.
- [ ] Zero database connection downtime during automated secret rotation.

## Notes
- **Complexity Rating:** Hard
- **Subsystem Notes:** Critical fix to prevent catastrophic outage during automated secret rotation.

**GitHub Issue:** [1434](https://github.com/Ethereal-Future/FuTuRe/issues/1434)
