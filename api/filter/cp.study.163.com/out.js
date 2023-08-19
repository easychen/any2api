module.exports = function outFilter( data )
{
    return {...data, headers:{...data.headers, "ai-api":"very-good" }};
}