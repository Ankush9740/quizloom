import { PlayerRoom } from "@/components/player-room";
export default async function PlayerRoomPage({ params }: { params: Promise<{ code: string }> }) { return <PlayerRoom code={(await params).code}/>; }
