"""Autentificare simplă pe bază de token, cu rolurile ``operator`` și ``viewer``.

``viewer`` poate doar citi. ``operator`` poate în plus porni și opri
înregistrarea unei sesiuni. Dacă niciun token nu este configurat (cazul obișnuit
în dezvoltare), verificarea este dezactivată și toată lumea are rol de operator.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import Depends, Header, HTTPException, status

from .config import settings

Role = Literal["operator", "viewer"]


def role_for_token(token: str | None) -> Role | None:
    if not settings.auth_enabled:
        return "operator"

    if token and settings.operator_token and token == settings.operator_token:
        return "operator"

    if token and settings.viewer_token and token == settings.viewer_token:
        return "viewer"

    return None


def _token_from_header(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return value.strip() or None


async def current_role(
    authorization: Annotated[str | None, Header()] = None,
) -> Role:
    role = role_for_token(_token_from_header(authorization))
    if role is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token lipsă sau invalid.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return role


async def require_operator(role: Annotated[Role, Depends(current_role)]) -> Role:
    if role != "operator":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Această operație necesită rolul de operator.",
        )
    return role


ViewerRole = Annotated[Role, Depends(current_role)]
OperatorRole = Annotated[Role, Depends(require_operator)]
