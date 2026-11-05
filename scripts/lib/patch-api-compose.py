# Add the price archive mount to the TrueNAS custom app compose.
# Existing environment values, including secrets, are left as they are.

import os
import subprocess
from pathlib import Path

import yaml

nas_dir = os.environ["NAS_DIR"]
ix_app_dir = Path(os.environ["IX_APP_DIR"])
volume = f"{nas_dir}/data:/data"
archive_env = {
    "PREDICTION_DB_PATH": "/data/prediction.sqlite",
    "WATTSONIC_DAYS_DIR": "/data/wattsonic/days",
    "TESLAMATE_MQTT_HOST": "mosquitto",
}


# Copy TeslaMate's database login onto the API. Values are not printed.
def teslamate_database_env():
    try:
        raw = subprocess.check_output(
            [
                "docker",
                "inspect",
                "ix-teslamate-teslamate-1",
                "--format",
                "{{range .Config.Env}}{{println .}}{{end}}",
            ],
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return {}
    found = {}
    for line in raw.splitlines():
        key, separator, value = line.partition("=")
        if separator and key in {"DATABASE_USER", "DATABASE_PASS", "DATABASE_NAME"}:
            found[key] = value
    if not {"DATABASE_USER", "DATABASE_PASS", "DATABASE_NAME"} <= found.keys():
        return {}
    return {
        "TESLAMATE_DATABASE_HOST": "database",
        "TESLAMATE_DATABASE_USER": found["DATABASE_USER"],
        "TESLAMATE_DATABASE_PASSWORD": found["DATABASE_PASS"],
        "TESLAMATE_DATABASE_NAME": found["DATABASE_NAME"],
    }


archive_env.update(teslamate_database_env())
compose_paths = [
    ix_app_dir / "user_config.yaml",
    ix_app_dir / "templates" / "rendered" / "docker-compose.yaml",
]

for path in compose_paths:
    document = yaml.safe_load(path.read_text())
    service = document["services"]["api"]
    environment = service.setdefault("environment", {})
    for key, value in archive_env.items():
        environment.setdefault(key, value)
    volumes = service.setdefault("volumes", [])
    if volume not in volumes:
        volumes.append(volume)
    if path.name == "docker-compose.yaml":
        networks = service.setdefault("networks", [])
        if "default" not in networks:
            networks.insert(0, "default")
        if "teslamate" not in networks:
            networks.append("teslamate")
        document.setdefault("networks", {})
        document["networks"]["teslamate"] = {
            "name": "ix-teslamate_default",
            "external": True,
        }
    path.write_text(yaml.safe_dump(document, sort_keys=False))

print("api compose keeps the price archive on the NAS")
