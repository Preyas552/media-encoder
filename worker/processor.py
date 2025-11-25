import ffmpeg
import os

def transcode_video(input_path, output_path, output_format='mp4'):
    """
    Transcodes a video file to 720p using FFmpeg.
    """
    try:
        print(f"Processing {input_path} -> {output_path} (format: {output_format})")
        stream = ffmpeg.input(input_path)
        # Basic mapping for codecs, though ffmpeg often handles this by extension
        output_args = {}
        
        if output_format in ['jpg', 'jpeg']:
            # No specific codec needed, ffmpeg handles it. Maybe set quality.
            output_args = {'qscale:v': 2}
        elif output_format == 'png':
            # PNG is lossless usually
            pass
        elif output_format == 'webp':
            output_args = {'vcodec': 'libwebp'}
        elif output_format == 'webm':
            output_args = {'vcodec': 'libvpx-vp9', 'crf': 23, 'preset': 'fast', 's': '1280x720'}
        else:
            # Default video settings
            output_args = {'vcodec': 'libx264', 'crf': 23, 'preset': 'fast', 's': '1280x720'}
        
        stream = ffmpeg.output(stream, output_path, **output_args)
        ffmpeg.run(stream, overwrite_output=True)
        print("Transcoding complete")
        return True
    except ffmpeg.Error as e:
        print(f"FFmpeg error: {e.stderr.decode('utf8')}")
        return False
    except Exception as e:
        print(f"Error transcoding video: {e}")
        return False
