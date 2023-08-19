module.exports = function chunkFilter( data )
{
    return {...data, id: data.id+'-fix'};
}