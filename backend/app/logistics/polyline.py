"""Google encoded polyline algorithm (precision 5), pure functions."""

Coord = tuple[float, float]  # (lat, lng)


def decode(encoded: str, precision: int = 5) -> list[Coord]:
    factor = 10**precision
    coords: list[Coord] = []
    index = 0
    lat = 0
    lng = 0
    n = len(encoded)
    while index < n:
        deltas = []
        for _ in range(2):
            result = 0
            shift = 0
            while True:
                if index >= n:
                    raise ValueError("Truncated polyline")
                b = ord(encoded[index]) - 63
                index += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            deltas.append(~(result >> 1) if result & 1 else result >> 1)
        lat += deltas[0]
        lng += deltas[1]
        coords.append((lat / factor, lng / factor))
    return coords


def _encode_value(value: int) -> str:
    value = ~(value << 1) if value < 0 else value << 1
    out = []
    while value >= 0x20:
        out.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    out.append(chr(value + 63))
    return "".join(out)


def encode(coords: list[Coord], precision: int = 5) -> str:
    factor = 10**precision
    prev_lat = 0
    prev_lng = 0
    out = []
    for lat, lng in coords:
        ilat = round(lat * factor)
        ilng = round(lng * factor)
        out.append(_encode_value(ilat - prev_lat))
        out.append(_encode_value(ilng - prev_lng))
        prev_lat = ilat
        prev_lng = ilng
    return "".join(out)
