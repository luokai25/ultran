"""Avatar, scenes, voice and the shared theme."""

from __future__ import annotations

from fastapi import APIRouter

from ..schemas import AvatarMove, AvatarState, VoiceLine, VoiceRendered
from ..theme import theme as theme_payload
from .deps import ContainerDep, WorkspaceDep

router = APIRouter(prefix="/workspace", tags=["workspace"])


@router.get("/theme")
def theme():
    return theme_payload()


@router.get("/avatar", response_model=AvatarState)
def avatar(container: ContainerDep, workspace: WorkspaceDep):
    return container.avatar.state(workspace)


@router.post("/avatar/move", response_model=AvatarState)
def move(payload: AvatarMove, container: ContainerDep, workspace: WorkspaceDep):
    return container.avatar.move(
        workspace,
        scene=payload.scene,
        x=payload.x,
        y=payload.y,
        z=payload.z,
        emotion=payload.emotion,
    )


@router.get("/scenes")
def scenes(container: ContainerDep):
    return container.avatar.scene_manifest()


@router.get("/voice/profiles")
def voice_profiles(container: ContainerDep):
    return container.voice.profiles()


@router.post("/voice/speak", response_model=VoiceRendered)
def speak(payload: VoiceLine, container: ContainerDep):
    rendered = container.voice.render(
        payload.text, voice=payload.voice, speed=payload.speed, pitch=payload.pitch
    )
    rendered.pop("profile", None)
    rendered.pop("visemes", None)
    return rendered
