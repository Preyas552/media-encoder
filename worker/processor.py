import ffmpeg
import os

def transcode_video(input_path, output_path):
    """
    Transcodes a video file to 720p MP4 using FFmpeg.
    """
    try:
        print(f"Processing {input_path} -> {output_path}")
        stream = ffmpeg.input(input_path)
        stream = ffmpeg.output(stream, output_path, vcodec='libx264', crf=23, preset='fast', s='1280x720')
        ffmpeg.run(stream, overwrite_output=True)
        print("Transcoding complete")
        return True
    except ffmpeg.Error as e:
        print(f"FFmpeg error: {e.stderr.decode('utf8')}")
        return False
    except Exception as e:
        print(f"Error transcoding video: {e}")
        return False
