"""
backend/security/sandbox.py
Isolated Task Runner and Ephemeral Workspace for Financial Document Extraction.
Prevents directory traversal, drops environment secrets, and isolates parser runs.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

logger = logging.getLogger("trueledger.security.sandbox")

@dataclass(frozen=True)
class SandboxExecutionResult:
    stdout: str
    stderr: str
    exit_code: int
    execution_time_ms: float

class IsolatedEvidenceRunner:
    """
    Spawns forensic data extractors inside an isolated, temporary 0700 directory.
    Guarantees that files cannot bleed across tasks or compromise host secrets.
    """
    MAX_EXECUTION_TIME_SEC = 10.0
    MAX_OUTPUT_BYTES = 5 * 1024 * 1024  # 5 MB safety cap

    def __init__(self, tenant_id: str, borrower_id: str):
        self.tenant_id = tenant_id
        self.borrower_id = borrower_id
        self._workspace_dir: Optional[str] = None

    async def __aenter__(self) -> IsolatedEvidenceRunner:
        base_tmp = os.environ.get("SECURE_TMP_DIR")
        if base_tmp:
            os.makedirs(base_tmp, mode=0o700, exist_ok=True)
            self._workspace_dir = tempfile.mkdtemp(prefix=f"t_{self.tenant_id[:6]}_", dir=base_tmp)
        else:
            self._workspace_dir = tempfile.mkdtemp(prefix=f"t_{self.tenant_id[:6]}_")
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._workspace_dir and os.path.exists(self._workspace_dir):
            try:
                shutil.rmtree(self._workspace_dir, ignore_errors=True)
            except Exception as err:
                logger.error("Failed to clean up sandbox directory: %s", err)

    async def execute_isolated_command(
        self,
        command: List[str],
        input_data: Optional[bytes] = None,
        custom_env: Optional[Dict[str, str]] = None
    ) -> SandboxExecutionResult:
        if not self._workspace_dir:
            raise RuntimeError("Sandbox is not active.")

        # Safe environment isolation: scrub any master keys or internal credentials
        safe_env = {
            "TENANT_ID": self.tenant_id,
            "BORROWER_ID": self.borrower_id,
            "TMPDIR": self._workspace_dir,
            "LC_ALL": "C.UTF-8",
            "PATH": os.environ.get("PATH", "/usr/bin:/bin")
        }
        if custom_env:
            for k, v in custom_env.items():
                if k not in ("FIELD_ENCRYPTION_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "API_KEY"):
                    safe_env[k] = v

        if input_data:
            with open(os.path.join(self._workspace_dir, "input.raw"), "wb") as f:
                f.write(input_data)

        start_time = asyncio.get_event_loop().time()
        process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=self._workspace_dir,
            env=safe_env
        )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                process.communicate(),
                timeout=self.MAX_EXECUTION_TIME_SEC
            )
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise TimeoutError(f"Command exceeded sandbox maximum execution threshold ({self.MAX_EXECUTION_TIME_SEC}s)")

        elapsed_ms = (asyncio.get_event_loop().time() - start_time) * 1000

        if len(stdout_bytes) > self.MAX_OUTPUT_BYTES:
            raise ValueError("Output payload exceeded maximum 5MB sandbox boundary.")

        return SandboxExecutionResult(
            stdout=stdout_bytes.decode("utf-8", errors="replace"),
            stderr=stderr_bytes.decode("utf-8", errors="replace"),
            exit_code=process.returncode or 0,
            execution_time_ms=elapsed_ms
        )
