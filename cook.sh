#!/bin/sh
# Copyright (c) 2017 Yahweasel
#
# Permission to use, copy, modify, and/or distribute this software for any
# purpose with or without fee is hereby granted, provided that the above
# copyright notice and this permission notice appear in all copies.
#
# THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
# WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
# MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
# SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
# WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
# OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
# CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

set -e
[ "$1" ]

FORMAT=flac
[ "$2" ] && FORMAT="$2"

CONTAINER=zip
[ "$3" ] && CONTAINER="$3"

case "$FORMAT" in
    vorbis)
        ext=ogg
        ENCODE="oggenc -q 6 -"
        ;;
    aac)
        ext=aac
        #ENCODE="faac -q 100 -o /dev/stdout -"
        ENCODE="fdkaac -f 2 -m 4 -o - -"
        ;;
    mp3)
        ext=mp3
        ENCODE="lame -V 2 - -"
        ;;
    *)
        ext=flac
        ENCODE="flac - -c"
        ;;
esac

cd `dirname "$0"`/rec

tmpdir=`mktemp -d`
[ "$tmpdir" -a -d "$tmpdir" ]

echo 'rm -rf '"$tmpdir" | at 'now + 2 hours'

NB_STREAMS=`cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data | ffprobe -print_format flat -show_format - 2> /dev/null |
    grep '^format\.nb_streams' |
    sed 's/^[^=]*=//'`

# Make all the fifos
NICE="nice -n10 ionice -c3"
for c in `seq 0 $((NB_STREAMS-1))`
do
    mkfifo $tmpdir/$((c+1)).$ext
    $NICE cat $1.ogg.header1 $1.ogg.header2 $1.ogg.data |
        $NICE ffmpeg -codec libopus -copyts -i - \
        -map 0:$c -af aresample=async=480,asyncts=first_pts=0 \
        -f wav - |
        $NICE $ENCODE > $tmpdir/$((c+1)).$ext &
done

# Put them into their container
cd $tmpdir
case "$CONTAINER" in
    matroska)
        INPUT=""
        MAP=""
        c=0
        for i in *.$ext
        do
            INPUT="$INPUT -i $i"
            MAP="$MAP -map $c"
            c=$((c+1))
        done
        $NICE ffmpeg $INPUT $MAP -c:a copy -f $CONTAINER -
        ;;

    *)
        zip -1 -FI - *.$ext
        ;;
esac | cat

# And clean up after ourselves
cd
rm -rf $tmpdir
